/**
 * Test-only Customer live fixture cleanup helpers (Development US).
 * Not a public API. Cleanup is exact-ID / disposable-owner scoped — never name/email wildcards.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";

export type SqlClient = ReturnType<typeof postgres>;

/** Unique suffix for disposable live fixture labels (diagnostics only). */
export function createCustomerTestRunId(): string {
  return randomUUID().slice(0, 8);
}

export function liveDevelopmentApiUrl(): string | undefined {
  if (process.env["APP_ENV"] === "production" || process.env["APP_ENV"] === "staging") {
    return undefined;
  }
  const url = process.env["DATABASE_URL_API"];
  if (url === undefined || url.trim() === "") {
    return undefined;
  }
  return url;
}

/**
 * Tracks IDs created by one live/memory Customer test run.
 * Cleanup may only target IDs owned by this scope.
 */
export class CustomerFixtureScope {
  readonly runId: string;
  readonly authSubjects = new Set<string>();
  readonly customerIds = new Set<string>();
  readonly jobIds = new Set<string>();
  readonly workspaceIds = new Set<string>();

  constructor(runId = createCustomerTestRunId()) {
    this.runId = runId;
  }

  trackAuth(authSubject: string): void {
    this.authSubjects.add(authSubject);
  }

  trackCustomer(id: string): void {
    this.customerIds.add(id);
  }

  trackJob(id: string): void {
    this.jobIds.add(id);
  }

  trackWorkspace(id: string): void {
    this.workspaceIds.add(id);
  }

  assertOwnsCustomer(id: string): void {
    if (!this.customerIds.has(id)) {
      throw new Error(`CustomerFixtureScope refuses untracked customer id: ${id}`);
    }
  }

  assertOwnsJob(id: string): void {
    if (!this.jobIds.has(id)) {
      throw new Error(`CustomerFixtureScope refuses untracked job id: ${id}`);
    }
  }

  snapshot(): {
    runId: string;
    authSubjects: string[];
    customerIds: string[];
    jobIds: string[];
    workspaceIds: string[];
  } {
    return {
      runId: this.runId,
      authSubjects: [...this.authSubjects],
      customerIds: [...this.customerIds],
      jobIds: [...this.jobIds],
      workspaceIds: [...this.workspaceIds],
    };
  }
}

/**
 * Deletes a disposable owner workspace created for this test (by unique auth_user_id).
 * Order: jobs → customers → allowances → memberships → workspace → idempotency → app_user.
 * Does not delete by Customer name/email.
 */
export async function cleanupDisposableOwnerByAuth(
  sql: SqlClient,
  authUserId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
    const users = await tx<{ id: string }[]>`
      select id from app.app_users where auth_user_id = ${authUserId} limit 1
    `;
    const userId = users[0]?.id;
    if (!userId) return;
    const workspaces = await tx<{ id: string }[]>`
      select id from app.workspaces where owner_user_id = ${userId}::uuid limit 1
    `;
    const workspaceId = workspaces[0]?.id;
    if (workspaceId) {
      await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
      await tx`delete from app.jobs where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.job_allowances where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.memberships where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
    }
    await tx`delete from app.idempotency_records where actor_scope = ${userId}`;
    await tx`delete from app.app_users where id = ${userId}::uuid`;
  });
}

/** Exact-ID cleanup for tracked commercial rows (jobs before customers). */
export async function cleanupTrackedCommercialRows(
  sql: SqlClient,
  scope: CustomerFixtureScope,
  workspaceId: string,
): Promise<void> {
  if (!scope.workspaceIds.has(workspaceId) && scope.workspaceIds.size > 0) {
    throw new Error(
      `CustomerFixtureScope refuses cleanup for untracked workspace: ${workspaceId}`,
    );
  }
  const jobIds = [...scope.jobIds];
  const customerIds = [...scope.customerIds];
  await sql.begin(async (tx) => {
    await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
    if (jobIds.length > 0) {
      await tx`delete from app.jobs where workspace_id = ${workspaceId}::uuid and id = any(${jobIds}::uuid[])`;
    }
    if (customerIds.length > 0) {
      await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid and id = any(${customerIds}::uuid[])`;
    }
  });
}

export async function countTrackedResiduals(
  sql: SqlClient,
  scope: CustomerFixtureScope,
): Promise<{ customers: number; jobs: number }> {
  const customerIds = [...scope.customerIds];
  const jobIds = [...scope.jobIds];
  let customers = 0;
  let jobs = 0;

  // Prefer workspace-scoped counts under tenant GUC (FORCE RLS on app_api_login).
  const workspaceIds = [...scope.workspaceIds];
  if (workspaceIds.length === 0 && (customerIds.length > 0 || jobIds.length > 0)) {
    // Fallback: resolve workspace from disposable auth subjects.
    for (const authUserId of scope.authSubjects) {
      const found = await sql.begin(async (tx) => {
        await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
        const users = await tx<{ id: string }[]>`
          select id from app.app_users where auth_user_id = ${authUserId} limit 1
        `;
        const userId = users[0]?.id;
        if (!userId) return null;
        const workspaces = await tx<{ id: string }[]>`
          select id from app.workspaces where owner_user_id = ${userId}::uuid limit 1
        `;
        return workspaces[0]?.id ?? null;
      });
      if (found) workspaceIds.push(found);
    }
  }

  for (const workspaceId of workspaceIds) {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
      if (customerIds.length > 0) {
        const rows = await tx<{ n: string }[]>`
          select count(*)::text as n
          from app.customers
          where workspace_id = ${workspaceId}::uuid
            and id = any(${customerIds}::uuid[])
        `;
        customers += Number(rows[0]?.n ?? 0);
      }
      if (jobIds.length > 0) {
        const rows = await tx<{ n: string }[]>`
          select count(*)::text as n
          from app.jobs
          where workspace_id = ${workspaceId}::uuid
            and id = any(${jobIds}::uuid[])
        `;
        jobs += Number(rows[0]?.n ?? 0);
      }
    });
  }

  // If no workspace remains (owner fully cleaned), residuals must be zero by definition
  // for disposable owners — still report zeros when tracked IDs were cleaned with the owner.
  if (workspaceIds.length === 0) {
    return { customers: 0, jobs: 0 };
  }
  return { customers, jobs };
}

export async function assertNoTrackedResiduals(
  sql: SqlClient,
  scope: CustomerFixtureScope,
): Promise<void> {
  const residual = await countTrackedResiduals(sql, scope);
  assert.equal(
    residual.customers,
    0,
    `RUN_CUSTOMERS_REMAINING=${residual.customers}`,
  );
  assert.equal(residual.jobs, 0, `RUN_JOBS_REMAINING=${residual.jobs}`);
}

/**
 * Cleans every disposable auth subject tracked by the scope, then asserts
 * tracked commercial IDs are gone. Cleanup errors are rethrown (not swallowed).
 */
export async function finalizeCustomerLiveScope(
  sql: SqlClient,
  scope: CustomerFixtureScope,
): Promise<void> {
  const errors: unknown[] = [];
  for (const auth of scope.authSubjects) {
    try {
      await cleanupDisposableOwnerByAuth(sql, auth);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Customer live fixture cleanup failed");
  }
  await assertNoTrackedResiduals(sql, scope);
}

/** In-memory fixture registry for cleanup-on-failure / concurrent safety tests. */
export class MemoryCustomerFixtureRegistry {
  private readonly rows = new Map<
    string,
    { owner: string; kind: "customer" | "job"; alive: boolean }
  >();

  create(owner: string, kind: "customer" | "job", id: string): void {
    this.rows.set(id, { owner, kind, alive: true });
  }

  cleanupOwner(owner: string): void {
    for (const [id, row] of this.rows) {
      if (row.owner === owner && row.alive) {
        if (row.kind === "job") {
          this.rows.set(id, { ...row, alive: false });
        }
      }
    }
    for (const [id, row] of this.rows) {
      if (row.owner === owner && row.alive && row.kind === "customer") {
        this.rows.set(id, { ...row, alive: false });
      }
    }
  }

  /** Jobs before customers for one owner. Refuses foreign owner. */
  cleanupExact(owner: string, jobIds: string[], customerIds: string[]): void {
    for (const id of [...jobIds, ...customerIds]) {
      const row = this.rows.get(id);
      if (!row) {
        throw new Error(`refuses untracked id: ${id}`);
      }
      if (row.owner !== owner) {
        throw new Error(`refuses foreign-owned id: ${id}`);
      }
    }
    for (const id of jobIds) {
      const row = this.rows.get(id)!;
      this.rows.set(id, { ...row, alive: false });
    }
    for (const id of customerIds) {
      const row = this.rows.get(id)!;
      this.rows.set(id, { ...row, alive: false });
    }
  }

  aliveCount(owner?: string): { customers: number; jobs: number } {
    let customers = 0;
    let jobs = 0;
    for (const row of this.rows.values()) {
      if (!row.alive) continue;
      if (owner !== undefined && row.owner !== owner) continue;
      if (row.kind === "customer") customers += 1;
      else jobs += 1;
    }
    return { customers, jobs };
  }
}
