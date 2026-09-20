import { conflict, decodeCustomerListCursor, encodeCustomerListCursor, escapeLikePattern } from "@job-to-invoice/domain";
import type {
  AccountStatus,
  Customer,
  DuplicateCustomerMatch,
  UsAddress,
  WorkspaceTrade,
} from "@job-to-invoice/domain";
import postgres from "postgres";
import type {
  AllowanceRecord,
  AppUserRecord,
  AuthStore,
  IdempotencyRecord,
  MembershipRecord,
  OwnerTx,
  WorkspaceBundle,
  WorkspaceRecord,
} from "./types.ts";

type Sql = ReturnType<typeof postgres>;

function asStatus(value: string): AccountStatus {
  if (value === "active" || value === "suspended" || value === "deleting" || value === "deleted") {
    return value;
  }
  return "active";
}

function asTrade(value: string): WorkspaceTrade {
  return value === "other" ? "other" : "handyman";
}

export function createPostgresAuthStore(databaseUrl: string): AuthStore {
  const sql: Sql = postgres(databaseUrl, {
    max: 8,
    prepare: false,
  });

  return {
    async withOwnerTransaction<T>(authUserId: string, fn: (tx: OwnerTx) => Promise<T>): Promise<T> {
      const result = await sql.begin(async (tx) => {
        await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
        const ownerTx: OwnerTx = {
          async findUserByAuthId(id) {
            const rows = await tx<AppUserRecord[]>`
              select id, auth_user_id, normalized_email, display_email, status,
                     last_authenticated_at, deletion_requested_at, terms_version,
                     privacy_version, created_at, updated_at
              from app.app_users
              where auth_user_id = ${id}
              limit 1
            `;
            const row = rows[0];
            if (!row) return null;
            return { ...row, status: asStatus(row.status) };
          },
          async insertUser(input) {
            const rows = await tx<AppUserRecord[]>`
              insert into app.app_users (
                id, auth_user_id, normalized_email, display_email, status,
                last_authenticated_at, terms_version, privacy_version, created_at, updated_at
              ) values (
                ${input.id}::uuid, ${input.authUserId}, ${input.normalizedEmail}, ${input.displayEmail},
                'active', ${input.now}::timestamptz, ${input.termsVersion}, ${input.privacyVersion},
                ${input.now}::timestamptz, ${input.now}::timestamptz
              )
              on conflict (auth_user_id) do update
                set last_authenticated_at = excluded.last_authenticated_at,
                    display_email = excluded.display_email,
                    normalized_email = excluded.normalized_email,
                    updated_at = excluded.updated_at
              returning id, auth_user_id, normalized_email, display_email, status,
                        last_authenticated_at, deletion_requested_at, terms_version,
                        privacy_version, created_at, updated_at
            `;
            const row = rows[0];
            if (!row) {
              throw new Error("insert user failed");
            }
            return { ...row, status: asStatus(row.status) };
          },
          async touchAuthentication(userId, displayEmail, normalizedEmail, now) {
            const rows = await tx<AppUserRecord[]>`
              update app.app_users
              set display_email = ${displayEmail},
                  normalized_email = ${normalizedEmail},
                  last_authenticated_at = ${now}::timestamptz,
                  updated_at = ${now}::timestamptz
              where id = ${userId}::uuid
              returning id, auth_user_id, normalized_email, display_email, status,
                        last_authenticated_at, deletion_requested_at, terms_version,
                        privacy_version, created_at, updated_at
            `;
            const row = rows[0];
            if (!row) {
              throw new Error("touch user failed");
            }
            return { ...row, status: asStatus(row.status) };
          },
          async findWorkspaceByOwner(userId) {
            const workspaces = await tx<WorkspaceRecord[]>`
              select id, owner_user_id, business_name, legal_name, contact_name, contact_email,
                     contact_phone, address_json as address, timezone, currency, trade, logo_asset_id,
                     default_tax_bp, default_due_days, default_terms, version, created_at, updated_at, created_by
              from app.workspaces
              where owner_user_id = ${userId}::uuid
              limit 1
            `;
            const workspace = workspaces[0];
            if (!workspace) return null;
            await tx`select set_config('app.workspace_id', ${workspace.id}, true)`;
            const memberships = await tx<MembershipRecord[]>`
              select id, workspace_id, user_id, role, status, version, created_at, updated_at, created_by
              from app.memberships
              where workspace_id = ${workspace.id}::uuid and user_id = ${userId}::uuid
              limit 1
            `;
            const allowances = await tx<AllowanceRecord[]>`
              select id, workspace_id, free_jobs_consumed, trial_started_at, trial_ends_at,
                     trial_jobs_consumed, retained_bytes, version, created_at, updated_at, created_by
              from app.job_allowances
              where workspace_id = ${workspace.id}::uuid
              limit 1
            `;
            const membership = memberships[0];
            const allowance = allowances[0];
            if (!membership || !allowance) return null;
            return mapBundle(workspace, membership, allowance);
          },
          async createWorkspace(input) {
            const existing = await ownerTx.findWorkspaceByOwner(input.userId);
            if (existing) {
              throw conflict("WORKSPACE_EXISTS", "A workspace already exists for this account.");
            }
            const workspaceId = crypto.randomUUID();
            await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
            try {
              const workspaces = await tx<WorkspaceRecord[]>`
                insert into app.workspaces (
                  id, owner_user_id, business_name, legal_name, contact_name, contact_email,
                  contact_phone, address_json, timezone, currency, trade, default_tax_bp,
                  default_due_days, default_terms, version, created_at, updated_at, created_by
                ) values (
                  ${workspaceId}::uuid, ${input.userId}::uuid, ${input.fields.business_name},
                  ${input.fields.legal_name}, ${input.fields.contact_name}, ${input.fields.contact_email},
                  ${input.fields.contact_phone}, ${tx.json(input.fields.address)}, ${input.fields.timezone},
                  'USD', ${input.fields.trade}, ${input.fields.default_tax_bp}, ${input.fields.default_due_days},
                  ${input.fields.default_terms}, 1, ${input.now}::timestamptz, ${input.now}::timestamptz,
                  ${input.userId}::uuid
                )
                returning id, owner_user_id, business_name, legal_name, contact_name, contact_email,
                          contact_phone, address_json as address, timezone, currency, trade, logo_asset_id,
                          default_tax_bp, default_due_days, default_terms, version, created_at, updated_at, created_by
              `;
              const memberships = await tx<MembershipRecord[]>`
                insert into app.memberships (
                  id, workspace_id, user_id, role, status, version, created_at, updated_at, created_by
                ) values (
                  ${crypto.randomUUID()}::uuid, ${workspaceId}::uuid, ${input.userId}::uuid, 'owner', 'active',
                  1, ${input.now}::timestamptz, ${input.now}::timestamptz, ${input.userId}::uuid
                )
                returning id, workspace_id, user_id, role, status, version, created_at, updated_at, created_by
              `;
              const allowances = await tx<AllowanceRecord[]>`
                insert into app.job_allowances (
                  id, workspace_id, free_jobs_consumed, trial_jobs_consumed, retained_bytes, version,
                  created_at, updated_at, created_by
                ) values (
                  ${crypto.randomUUID()}::uuid, ${workspaceId}::uuid, 0, 0, 0, 1,
                  ${input.now}::timestamptz, ${input.now}::timestamptz, ${input.userId}::uuid
                )
                returning id, workspace_id, free_jobs_consumed, trial_started_at, trial_ends_at,
                          trial_jobs_consumed, retained_bytes, version, created_at, updated_at, created_by
              `;
              const workspace = workspaces[0];
              const membership = memberships[0];
              const allowance = allowances[0];
              if (!workspace || !membership || !allowance) {
                throw new Error("workspace create failed");
              }
              return mapBundle(workspace, membership, allowance);
            } catch (error) {
              const code = (error as { code?: string }).code;
              if (code === "23505") {
                throw conflict("WORKSPACE_EXISTS", "A workspace already exists for this account.");
              }
              throw error;
            }
          },
          async findCustomersByNormalizedEmail(workspaceId, normalizedEmail) {
            const rows = await tx<{ id: string; name: string }[]>`
              select id, name
              from app.customers
              where workspace_id = ${workspaceId}::uuid
                and normalized_email = ${normalizedEmail}
              order by created_at asc, id asc
            `;
            return rows.map(
              (row): DuplicateCustomerMatch => ({
                id: row.id,
                name: row.name,
              }),
            );
          },
          async createCustomer(input) {
            const customerId = crypto.randomUUID();
            const rows = await tx<
              {
                id: string;
                name: string;
                email: string | null;
                phone: string | null;
                billing_address: UsAddress | null;
                archived_at: string | null;
                version: number;
                created_at: string;
                updated_at: string;
              }[]
            >`
              insert into app.customers (
                id, workspace_id, name, email, normalized_email, phone,
                billing_address_json, archived_at, version, created_at, updated_at, created_by
              ) values (
                ${customerId}::uuid, ${input.workspaceId}::uuid, ${input.fields.name},
                ${input.fields.email}, ${input.fields.normalized_email}, ${input.fields.phone},
                ${input.fields.billing_address === null ? null : tx.json(input.fields.billing_address)},
                null, 1, ${input.now}::timestamptz, ${input.now}::timestamptz, ${input.createdBy}::uuid
              )
              returning id, name, email, phone, billing_address_json as billing_address,
                        archived_at, version, created_at, updated_at
            `;
            const row = rows[0];
            if (!row) {
              throw new Error("customer create failed");
            }
            const customer: Customer = {
              id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              billing_address: row.billing_address,
              archived_at: row.archived_at,
              version: row.version,
              created_at: row.created_at,
              updated_at: row.updated_at,
            };
            return customer;
          },
          async listCustomers(input) {
            const query = input.query;
            const cursor = query.cursor
              ? decodeCustomerListCursor(query.cursor, {
                  state: query.state,
                  search: query.search,
                })
              : null;
            const searchPattern =
              query.search !== null ? `%${escapeLikePattern(query.search)}%` : null;

            const stateFilter =
              query.state === "active"
                ? tx`and archived_at is null`
                : query.state === "archived"
                  ? tx`and archived_at is not null`
                  : tx``;

            const searchFilter =
              searchPattern === null
                ? tx``
                : tx`and (
                    name ilike ${searchPattern} escape '\\'
                    or coalesce(email, '') ilike ${searchPattern} escape '\\'
                    or coalesce(normalized_email, '') ilike ${searchPattern} escape '\\'
                  )`;

            const cursorFilter =
              cursor === null
                ? tx``
                : tx`and (
                    updated_at < ${cursor.updated_at}::timestamptz
                    or (
                      updated_at = ${cursor.updated_at}::timestamptz
                      and id < ${cursor.id}::uuid
                    )
                  )`;

            const rows = await tx<
              {
                id: string;
                name: string;
                email: string | null;
                phone: string | null;
                billing_address: UsAddress | null;
                archived_at: string | null;
                version: number;
                created_at: string;
                updated_at: string;
              }[]
            >`
              select id, name, email, phone, billing_address_json as billing_address,
                     archived_at, version, created_at, updated_at
              from app.customers
              where workspace_id = ${input.workspaceId}::uuid
              ${stateFilter}
              ${searchFilter}
              ${cursorFilter}
              order by updated_at desc, id desc
              limit ${query.limit + 1}
            `;

            const hasMore = rows.length > query.limit;
            const page = hasMore ? rows.slice(0, query.limit) : rows;
            const items: Customer[] = page.map((row) => ({
              id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              billing_address: row.billing_address,
              archived_at: row.archived_at,
              version: row.version,
              created_at: row.created_at,
              updated_at: row.updated_at,
            }));
            const last = items[items.length - 1];
            const next_cursor =
              hasMore && last
                ? encodeCustomerListCursor({
                    updated_at: last.updated_at,
                    id: last.id,
                    state: query.state,
                    search: query.search,
                  })
                : null;
            return { items, next_cursor };
          },
          async getIdempotency(actorScope, key) {
            const rows = await tx<IdempotencyRecord[]>`
              select actor_scope, key, route, request_hash, status_code, response_json
              from app.idempotency_records
              where actor_scope = ${actorScope} and key = ${key}
              limit 1
            `;
            return rows[0] ?? null;
          },
          async putIdempotency(record) {
            await tx`
              insert into app.idempotency_records (
                actor_scope, key, route, request_hash, operation_id, status, status_code, response_json, created_at, expires_at
              ) values (
                ${record.actor_scope}, ${record.key}, ${record.route}, ${record.request_hash},
                ${crypto.randomUUID()}::uuid, 'completed', ${record.status_code}, ${tx.json(JSON.parse(JSON.stringify(record.response_json)))},
                now(), now() + interval '30 days'
              )
              on conflict (actor_scope, key) do nothing
            `;
          },
        };
        return fn(ownerTx);
      });
      return result as T;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

function mapBundle(
  workspace: WorkspaceRecord,
  membership: MembershipRecord,
  allowances: AllowanceRecord,
): WorkspaceBundle {
  return {
    workspace: {
      ...workspace,
      trade: asTrade(workspace.trade),
      currency: "USD",
      address: workspace.address as UsAddress,
    },
    membership: {
      ...membership,
      role: "owner",
      status: "active",
    },
    allowances,
  };
}
