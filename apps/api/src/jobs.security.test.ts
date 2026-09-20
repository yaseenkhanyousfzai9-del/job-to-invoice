import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";

function liveDevelopmentApiUrl(): string | undefined {
  if (process.env["APP_ENV"] === "production" || process.env["APP_ENV"] === "staging") {
    return undefined;
  }
  const url = process.env["DATABASE_URL_API"];
  if (url === undefined || url.trim() === "") {
    return undefined;
  }
  return url;
}

const databaseUrl = liveDevelopmentApiUrl();

const F = {
  authA: "jobs-db-01-auth-a",
  authB: "jobs-db-01-auth-b",
  emailA: "jobs-db-01-a@example.test",
  emailB: "jobs-db-01-b@example.test",
  userA: "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1",
  userB: "b1b1b1b1-b1b1-41b1-81b1-b1b1b1b1b1b1",
  workspaceA: "c1c1c1c1-c1c1-41c1-81c1-c1c1c1c1c1c1",
  workspaceB: "d1d1d1d1-d1d1-41d1-81d1-d1d1d1d1d1d1",
  membershipA: "e1e1e1e1-e1e1-41e1-81e1-e1e1e1e1e1e1",
  membershipB: "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1",
  customerA1: "11111111-aaaa-4111-8111-aaaaaaaaaaaa",
  customerB1: "22222222-bbbb-4222-8222-bbbbbbbbbbbb",
  jobA1: "33333333-aaaa-4333-8333-aaaaaaaaaaaa",
  jobB1: "44444444-bbbb-4444-8444-bbbbbbbbbbbb",
  addressJson: JSON.stringify({
    line1: "1 Test St",
    city: "Austin",
    region: "TX",
    postal_code: "78701",
    country: "US",
  }),
} as const;

type Sql = ReturnType<typeof postgres>;

async function seedTenant(
  sql: Sql,
  authUserId: string,
  email: string,
  userId: string,
  workspaceId: string,
  membershipId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
    await tx`
      insert into app.app_users (
        id, auth_user_id, normalized_email, display_email, status,
        last_authenticated_at, terms_version, privacy_version
      ) values (
        ${userId}::uuid, ${authUserId}, ${email}, ${email}, 'active',
        now(), 't1', 'p1'
      )
      on conflict (id) do nothing
    `;
    await tx`
      insert into app.workspaces (
        id, owner_user_id, business_name, legal_name, contact_name, contact_email,
        address_json, timezone, currency, trade, created_by
      ) values (
        ${workspaceId}::uuid, ${userId}::uuid, 'Jobs DB', 'Jobs DB LLC',
        'Owner', ${email}, ${F.addressJson}::jsonb, 'America/Chicago', 'USD',
        'handyman', ${userId}::uuid
      )
      on conflict (id) do nothing
    `;
    await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
    await tx`
      insert into app.memberships (
        id, workspace_id, user_id, role, status, created_by
      ) values (
        ${membershipId}::uuid, ${workspaceId}::uuid, ${userId}::uuid, 'owner', 'active', ${userId}::uuid
      )
      on conflict (id) do nothing
    `;
  });
}

async function cleanupTenant(
  sql: Sql,
  authUserId: string,
  userId: string,
  workspaceId: string,
  membershipId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
    await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
    await tx`delete from app.jobs where workspace_id = ${workspaceId}::uuid`;
    await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid`;
    await tx`delete from app.memberships where id = ${membershipId}::uuid`;
    await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
    await tx`delete from app.app_users where id = ${userId}::uuid`;
  });
}

test("jobs table has FORCE RLS, composite customer FK, and required indexes", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    const rows = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = 'jobs'
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.relrowsecurity, true);
    assert.equal(rows[0]?.relforcerowsecurity, true);

    const fks = await sql<{ confdeltype: string; cols: string }[]>`
      select
        c.confdeltype::text as confdeltype,
        (
          select string_agg(att.attname, ',' order by u.ord)
          from unnest(c.conkey) with ordinality as u(attnum, ord)
          join pg_attribute att
            on att.attrelid = c.conrelid and att.attnum = u.attnum
        ) as cols
      from pg_constraint c
      join pg_class rel on rel.oid = c.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'app'
        and rel.relname = 'jobs'
        and c.contype = 'f'
        and c.conname = 'jobs_customer_same_workspace'
    `;
    assert.equal(fks.length, 1);
    assert.equal(fks[0]?.cols, "workspace_id,customer_id");
    // 'a' = NO ACTION, 'r' = RESTRICT — both block referenced customer delete.
    assert.ok(fks[0]?.confdeltype === "a" || fks[0]?.confdeltype === "r");

    const indexes = await sql<{ indexname: string }[]>`
      select indexname
      from pg_indexes
      where schemaname = 'app' and tablename = 'jobs'
    `;
    const names = new Set(indexes.map((row) => row.indexname));
    assert.ok(names.has("jobs_workspace_updated_id_idx"));
    assert.ok(names.has("jobs_workspace_lifecycle_updated_idx"));
    assert.ok(names.has("jobs_workspace_customer_updated_id_idx"));
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("jobs RLS isolation, same-workspace FK, cross-workspace FK reject, referenced customer delete blocked", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await cleanupTenant(sql, F.authA, F.userA, F.workspaceA, F.membershipA);
    await cleanupTenant(sql, F.authB, F.userB, F.workspaceB, F.membershipB);
    await seedTenant(sql, F.authA, F.emailA, F.userA, F.workspaceA, F.membershipA);
    await seedTenant(sql, F.authB, F.emailB, F.userB, F.workspaceB, F.membershipB);

    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      await tx`
        insert into app.customers (
          id, workspace_id, name, email, normalized_email, created_by
        ) values (
          ${F.customerA1}::uuid, ${F.workspaceA}::uuid, 'Alpha Customer',
          null, null, ${F.userA}::uuid
        )
      `;
    });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceB}, true)`;
      await tx`
        insert into app.customers (
          id, workspace_id, name, email, normalized_email, created_by
        ) values (
          ${F.customerB1}::uuid, ${F.workspaceB}::uuid, 'Beta Customer',
          null, null, ${F.userB}::uuid
        )
      `;
    });

    // No context → zero protected rows
    const none = await sql<{ n: number }[]>`select count(*)::int as n from app.jobs`;
    assert.equal(Number(none[0]?.n ?? -1), 0);

    // Same-workspace job insert succeeds
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      await tx`
        insert into app.jobs (
          id, workspace_id, customer_id, title, created_by
        ) values (
          ${F.jobA1}::uuid, ${F.workspaceA}::uuid, ${F.customerA1}::uuid,
          'Alpha Job', ${F.userA}::uuid
        )
      `;
      const own = await tx<{ id: string; customer_id: string; lifecycle: string }[]>`
        select id::text as id, customer_id::text as customer_id, lifecycle
        from app.jobs
        where id = ${F.jobA1}::uuid
      `;
      assert.equal(own.length, 1);
      assert.equal(own[0]?.customer_id, F.customerA1);
      assert.equal(own[0]?.lifecycle, "draft");
    });

    // Cross-workspace customer FK rejected (same UUID space, wrong workspace)
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`
            insert into app.jobs (
              id, workspace_id, customer_id, title, created_by
            ) values (
              ${crypto.randomUUID()}::uuid, ${F.workspaceA}::uuid, ${F.customerB1}::uuid,
              'Spoof Job', ${F.userA}::uuid
            )
          `;
        }),
      (error: unknown) => {
        const code = (error as { code?: string }).code;
        return code === "23503" || (error instanceof Error && /foreign key/i.test(error.message));
      },
    );

    // Invalid / unknown customer_id rejected
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`
            insert into app.jobs (
              id, workspace_id, customer_id, title, created_by
            ) values (
              ${crypto.randomUUID()}::uuid, ${F.workspaceA}::uuid,
              ${"99999999-9999-4999-8999-999999999999"}::uuid,
              'Missing Customer', ${F.userA}::uuid
            )
          `;
        }),
      (error: unknown) => {
        const code = (error as { code?: string }).code;
        return code === "23503" || (error instanceof Error && /foreign key/i.test(error.message));
      },
    );

    // Seed B job under B context
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceB}, true)`;
      await tx`
        insert into app.jobs (
          id, workspace_id, customer_id, title, created_by
        ) values (
          ${F.jobB1}::uuid, ${F.workspaceB}::uuid, ${F.customerB1}::uuid,
          'Beta Job', ${F.userB}::uuid
        )
      `;
    });

    // Workspace A cannot SELECT workspace B jobs
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const visible = await tx<{ id: string }[]>`select id::text as id from app.jobs`;
      assert.equal(visible.length, 1);
      assert.equal(visible[0]?.id, F.jobA1);
      const foreign = await tx<{ n: number }[]>`
        select count(*)::int as n from app.jobs where id = ${F.jobB1}::uuid
      `;
      assert.equal(Number(foreign[0]?.n ?? -1), 0);
    });

    // Workspace A cannot INSERT workspace B jobs
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`
            insert into app.jobs (
              id, workspace_id, customer_id, title, created_by
            ) values (
              ${crypto.randomUUID()}::uuid, ${F.workspaceB}::uuid, ${F.customerB1}::uuid,
              'Hijack Insert', ${F.userA}::uuid
            )
          `;
        }),
      (error: unknown) => error instanceof Error,
    );

    // Workspace A cannot UPDATE workspace B jobs
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const cross = await tx`
        update app.jobs
        set title = 'Hijack Update'
        where id = ${F.jobB1}::uuid
      `;
      assert.equal(cross.count, 0);
    });

    // Workspace A cannot DELETE workspace B jobs
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const cross = await tx`delete from app.jobs where id = ${F.jobB1}::uuid`;
      assert.equal(cross.count, 0);
    });

    // Unreferenced customer may be deleted (FK does not block)
    const orphanCustomer = "55555555-aaaa-4555-8555-aaaaaaaaaaaa";
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      await tx`
        insert into app.customers (
          id, workspace_id, name, email, normalized_email, created_by
        ) values (
          ${orphanCustomer}::uuid, ${F.workspaceA}::uuid, 'Orphan',
          null, null, ${F.userA}::uuid
        )
      `;
      const deleted = await tx`
        delete from app.customers where id = ${orphanCustomer}::uuid
      `;
      assert.equal(deleted.count, 1);
    });

    // Referenced customer delete blocked (CUS02 / R-CUS-31)
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`delete from app.customers where id = ${F.customerA1}::uuid`;
        }),
      (error: unknown) => {
        const code = (error as { code?: string }).code;
        return code === "23503" || (error instanceof Error && /foreign key|restrict|violates/i.test(error.message));
      },
    );
  } finally {
    await cleanupTenant(sql, F.authA, F.userA, F.workspaceA, F.membershipA);
    await cleanupTenant(sql, F.authB, F.userB, F.workspaceB, F.membershipB);
    await sql.end({ timeout: 5 });
  }
});
