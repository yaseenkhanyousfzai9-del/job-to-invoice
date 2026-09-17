import { conflict } from "@job-to-invoice/domain";
import postgres from "postgres";
import type { AuthStore, OwnerTx, AppUserRecord, WorkspaceBundle, IdempotencyRecord, WorkspaceRecord, MembershipRecord, AllowanceRecord } from "./types.ts";
import type { AccountStatus } from "@job-to-invoice/domain";
import type { UsAddress, WorkspaceTrade } from "@job-to-invoice/domain";

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
