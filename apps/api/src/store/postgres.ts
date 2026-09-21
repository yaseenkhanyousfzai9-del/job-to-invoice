import {
  conflict,
  decodeCustomerListCursor,
  decodeJobListCursor,
  encodeCustomerListCursor,
  encodeJobListCursor,
  escapeLikePattern,
} from "@job-to-invoice/domain";
import type {
  AccountStatus,
  Customer,
  DuplicateCustomerMatch,
  JobLifecycle,
  JobSummary,
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
          async findCustomersByNormalizedEmail(workspaceId, normalizedEmail, options) {
            const excludeId = options?.excludeCustomerId;
            const rows =
              excludeId === undefined
                ? await tx<{ id: string; name: string }[]>`
                    select id, name
                    from app.customers
                    where workspace_id = ${workspaceId}::uuid
                      and normalized_email = ${normalizedEmail}
                    order by created_at asc, id asc
                  `
                : await tx<{ id: string; name: string }[]>`
                    select id, name
                    from app.customers
                    where workspace_id = ${workspaceId}::uuid
                      and normalized_email = ${normalizedEmail}
                      and id <> ${excludeId}::uuid
                    order by created_at asc, id asc
                  `;
            return rows.map(
              (row): DuplicateCustomerMatch => ({
                id: row.id,
                name: row.name,
              }),
            );
          },
          async getCustomer(workspaceId, customerId) {
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
              where workspace_id = ${workspaceId}::uuid
                and id = ${customerId}::uuid
              limit 1
            `;
            const row = rows[0];
            if (!row) return null;
            return {
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
          async updateCustomer(input) {
            const locked = await tx<
              {
                id: string;
                name: string;
                email: string | null;
                normalized_email: string | null;
                phone: string | null;
                billing_address: UsAddress | null;
                archived_at: string | null;
                version: number;
                created_at: string;
                updated_at: string;
              }[]
            >`
              select id, name, email, normalized_email, phone,
                     billing_address_json as billing_address,
                     archived_at, version, created_at, updated_at
              from app.customers
              where workspace_id = ${input.workspaceId}::uuid
                and id = ${input.customerId}::uuid
              for update
            `;
            const current = locked[0];
            if (!current) {
              return { status: "not_found" };
            }
            if (current.version !== input.expectedVersion) {
              return {
                status: "version_conflict",
                customer: {
                  id: current.id,
                  name: current.name,
                  email: current.email,
                  phone: current.phone,
                  billing_address: current.billing_address,
                  archived_at: current.archived_at,
                  version: current.version,
                  created_at: current.created_at,
                  updated_at: current.updated_at,
                },
              };
            }

            const nextName = input.fields.name !== undefined ? input.fields.name : current.name;
            const nextEmail =
              input.fields.email !== undefined ? input.fields.email : current.email;
            const nextNormalized =
              input.fields.email !== undefined
                ? (input.fields.normalized_email ?? null)
                : current.normalized_email;
            const nextPhone =
              input.fields.phone !== undefined ? input.fields.phone : current.phone;
            const nextAddress =
              input.fields.billing_address !== undefined
                ? input.fields.billing_address
                : current.billing_address;

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
              update app.customers set
                name = ${nextName},
                email = ${nextEmail},
                normalized_email = ${nextNormalized},
                phone = ${nextPhone},
                billing_address_json = ${
                  nextAddress === null ? null : tx.json(nextAddress)
                },
                version = version + 1,
                updated_at = ${input.now}::timestamptz
              where workspace_id = ${input.workspaceId}::uuid
                and id = ${input.customerId}::uuid
                and version = ${input.expectedVersion}
              returning id, name, email, phone, billing_address_json as billing_address,
                        archived_at, version, created_at, updated_at
            `;
            const row = rows[0];
            if (!row) {
              // Concurrent writer won between lock and update (should be rare with FOR UPDATE).
              const again = await tx<
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
                  and id = ${input.customerId}::uuid
                limit 1
              `;
              const existingRow = again[0];
              if (!existingRow) {
                return { status: "not_found" };
              }
              return {
                status: "version_conflict",
                customer: {
                  id: existingRow.id,
                  name: existingRow.name,
                  email: existingRow.email,
                  phone: existingRow.phone,
                  billing_address: existingRow.billing_address,
                  archived_at: existingRow.archived_at,
                  version: existingRow.version,
                  created_at: existingRow.created_at,
                  updated_at: existingRow.updated_at,
                },
              };
            }
            return {
              status: "updated",
              customer: {
                id: row.id,
                name: row.name,
                email: row.email,
                phone: row.phone,
                billing_address: row.billing_address,
                archived_at: row.archived_at,
                version: row.version,
                created_at: row.created_at,
                updated_at: row.updated_at,
              },
            };
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
          async createJob(input) {
            const rows = await tx<
              {
                id: string;
                title: string;
                lifecycle: string;
                updated_at: string;
                customer_id: string;
              }[]
            >`
              insert into app.jobs (
                id, workspace_id, customer_id, title, created_by, created_at, updated_at
              ) values (
                ${input.id}::uuid, ${input.workspaceId}::uuid, ${input.customerId}::uuid,
                ${input.title}, ${input.createdBy}::uuid,
                ${input.now}::timestamptz, ${input.now}::timestamptz
              )
              returning id, title, lifecycle, updated_at, customer_id
            `;
            const row = rows[0];
            if (!row) {
              throw new Error("job create failed");
            }
            return {
              id: row.id,
              title: row.title,
              lifecycle: row.lifecycle as JobLifecycle,
              updated_at: row.updated_at,
              customer_id: row.customer_id,
            };
          },
          async listJobs(input) {
            const query = input.query;
            const cursor = query.cursor
              ? decodeJobListCursor(query.cursor, {
                  customer_id: query.customer_id,
                  state: query.state,
                  search: query.search,
                })
              : null;
            const searchPattern =
              query.search !== null ? `%${escapeLikePattern(query.search)}%` : null;

            const stateFilter =
              query.state === "all"
                ? tx``
                : query.state === "active"
                  ? tx`and lifecycle <> 'archived'`
                  : query.state === "archived"
                    ? tx`and lifecycle = 'archived'`
                    : tx`and lifecycle = ${query.state}`;

            const searchFilter =
              searchPattern === null
                ? tx``
                : tx`and title ilike ${searchPattern} escape '\\'`;

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
                title: string;
                lifecycle: string;
                updated_at: string;
                customer_id: string;
              }[]
            >`
              select id, title, lifecycle, updated_at, customer_id
              from app.jobs
              where workspace_id = ${input.workspaceId}::uuid
                and customer_id = ${query.customer_id}::uuid
              ${stateFilter}
              ${searchFilter}
              ${cursorFilter}
              order by updated_at desc, id desc
              limit ${query.limit + 1}
            `;

            const hasMore = rows.length > query.limit;
            const page = hasMore ? rows.slice(0, query.limit) : rows;
            const items: JobSummary[] = page.map((row) => ({
              id: row.id,
              title: row.title,
              lifecycle: row.lifecycle as JobLifecycle,
              updated_at: row.updated_at,
              customer_id: row.customer_id,
            }));
            const last = items[items.length - 1];
            const next_cursor =
              hasMore && last
                ? encodeJobListCursor({
                    updated_at: last.updated_at,
                    id: last.id,
                    customer_id: query.customer_id,
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
    async listCustomersAuthorized(authUserId, query) {
      return sql.begin(async (tx) => {
        // Auth GUC must be set before reading RLS-protected app_users.
        await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;

        const owners = await tx<
          {
            id: string;
            display_email: string;
            status: string;
            workspace_id: string | null;
          }[]
        >`
          with owner as (
            select
              u.id,
              u.display_email,
              u.status,
              w.id as workspace_id
            from app.app_users u
            left join app.workspaces w on w.owner_user_id = u.id
            left join app.memberships m
              on m.workspace_id = w.id
              and m.user_id = u.id
              and m.status = 'active'
            where u.auth_user_id = ${authUserId}
            limit 1
          ),
          guc as (
            select set_config(
              'app.workspace_id',
              coalesce((select workspace_id::text from owner), ''),
              true
            ) as workspace_guc
          )
          select owner.id, owner.display_email, owner.status, owner.workspace_id
          from owner
          cross join guc
        `;

        const owner = owners[0];
        if (!owner) {
          return { status: "no_user" as const };
        }

        const accountStatus = asStatus(owner.status);
        if (!owner.workspace_id) {
          return {
            status: "ok" as const,
            userId: owner.id,
            displayEmail: owner.display_email,
            accountStatus,
            page: { items: [] as Customer[], next_cursor: null },
          };
        }

        const workspaceId = owner.workspace_id;
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
          where workspace_id = ${workspaceId}::uuid
          ${stateFilter}
          ${searchFilter}
          ${cursorFilter}
          order by updated_at desc, id desc
          limit ${query.limit + 1}
        `;

        const hasMore = rows.length > query.limit;
        const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
        const items: Customer[] = pageRows.map((row) => ({
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

        return {
          status: "ok" as const,
          userId: owner.id,
          displayEmail: owner.display_email,
          accountStatus,
          page: { items, next_cursor },
        };
      });
    },
    async getCustomerAuthorized(authUserId, customerId) {
      return sql.begin(async (tx) => {
        await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;

        const owners = await tx<
          {
            id: string;
            display_email: string;
            status: string;
            workspace_id: string | null;
          }[]
        >`
          with owner as (
            select
              u.id,
              u.display_email,
              u.status,
              w.id as workspace_id
            from app.app_users u
            left join app.workspaces w on w.owner_user_id = u.id
            left join app.memberships m
              on m.workspace_id = w.id
              and m.user_id = u.id
              and m.status = 'active'
            where u.auth_user_id = ${authUserId}
            limit 1
          ),
          guc as (
            select set_config(
              'app.workspace_id',
              coalesce((select workspace_id::text from owner), ''),
              true
            ) as workspace_guc
          )
          select owner.id, owner.display_email, owner.status, owner.workspace_id
          from owner
          cross join guc
        `;

        const owner = owners[0];
        if (!owner) {
          return { status: "no_user" as const };
        }

        const accountStatus = asStatus(owner.status);
        if (!owner.workspace_id) {
          return {
            status: "ok" as const,
            userId: owner.id,
            displayEmail: owner.display_email,
            accountStatus,
            customer: null,
          };
        }

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
          where workspace_id = ${owner.workspace_id}::uuid
            and id = ${customerId}::uuid
          limit 1
        `;
        const row = rows[0];
        const customer: Customer | null = row
          ? {
              id: row.id,
              name: row.name,
              email: row.email,
              phone: row.phone,
              billing_address: row.billing_address,
              archived_at: row.archived_at,
              version: row.version,
              created_at: row.created_at,
              updated_at: row.updated_at,
            }
          : null;

        return {
          status: "ok" as const,
          userId: owner.id,
          displayEmail: owner.display_email,
          accountStatus,
          customer,
        };
      });
    },
    async listJobsAuthorized(authUserId, query) {
      return sql.begin(async (tx) => {
        await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;

        const owners = await tx<
          {
            id: string;
            display_email: string;
            status: string;
            workspace_id: string | null;
            customer_exists: boolean;
          }[]
        >`
          with owner as (
            select
              u.id,
              u.display_email,
              u.status,
              w.id as workspace_id
            from app.app_users u
            left join app.workspaces w on w.owner_user_id = u.id
            left join app.memberships m
              on m.workspace_id = w.id
              and m.user_id = u.id
              and m.status = 'active'
            where u.auth_user_id = ${authUserId}
            limit 1
          ),
          guc as (
            select set_config(
              'app.workspace_id',
              coalesce((select workspace_id::text from owner), ''),
              true
            ) as workspace_guc
          ),
          customer_check as (
            select exists(
              select 1
              from app.customers c
              where c.workspace_id = (select workspace_id from owner)
                and c.id = ${query.customer_id}::uuid
            ) as customer_exists
          )
          select
            owner.id,
            owner.display_email,
            owner.status,
            owner.workspace_id,
            customer_check.customer_exists
          from owner
          cross join guc
          cross join customer_check
        `;

        const owner = owners[0];
        if (!owner) {
          return { status: "no_user" as const };
        }

        const accountStatus = asStatus(owner.status);
        if (!owner.workspace_id || !owner.customer_exists) {
          return { status: "customer_not_found" as const };
        }

        const cursor = query.cursor
          ? decodeJobListCursor(query.cursor, {
              customer_id: query.customer_id,
              state: query.state,
              search: query.search,
            })
          : null;
        const searchPattern =
          query.search !== null ? `%${escapeLikePattern(query.search)}%` : null;

        const stateFilter =
          query.state === "all"
            ? tx``
            : query.state === "active"
              ? tx`and lifecycle <> 'archived'`
              : query.state === "archived"
                ? tx`and lifecycle = 'archived'`
                : tx`and lifecycle = ${query.state}`;

        const searchFilter =
          searchPattern === null
            ? tx``
            : tx`and title ilike ${searchPattern} escape '\\'`;

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
            title: string;
            lifecycle: string;
            updated_at: string;
            customer_id: string;
          }[]
        >`
          select id, title, lifecycle, updated_at, customer_id
          from app.jobs
          where workspace_id = ${owner.workspace_id}::uuid
            and customer_id = ${query.customer_id}::uuid
          ${stateFilter}
          ${searchFilter}
          ${cursorFilter}
          order by updated_at desc, id desc
          limit ${query.limit + 1}
        `;

        const hasMore = rows.length > query.limit;
        const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
        const items: JobSummary[] = pageRows.map((row) => ({
          id: row.id,
          title: row.title,
          lifecycle: row.lifecycle as JobLifecycle,
          updated_at: row.updated_at,
          customer_id: row.customer_id,
        }));
        const last = items[items.length - 1];
        const next_cursor =
          hasMore && last
            ? encodeJobListCursor({
                updated_at: last.updated_at,
                id: last.id,
                customer_id: query.customer_id,
                state: query.state,
                search: query.search,
              })
            : null;

        return {
          status: "ok" as const,
          userId: owner.id,
          displayEmail: owner.display_email,
          accountStatus,
          page: { items, next_cursor },
        };
      });
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
