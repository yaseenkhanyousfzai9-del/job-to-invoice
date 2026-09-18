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
  authA: "cust-db-01-auth-a",
  authB: "cust-db-01-auth-b",
  emailA: "cust-db-01-a@example.test",
  emailB: "cust-db-01-b@example.test",
  userA: "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0",
  userB: "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0",
  workspaceA: "c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0",
  workspaceB: "d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0",
  membershipA: "e0e0e0e0-e0e0-40e0-80e0-e0e0e0e0e0e0",
  membershipB: "f0f0f0f0-f0f0-40f0-80f0-f0f0f0f0f0f0",
  customerA1: "11111111-aaaa-4111-8111-111111111111",
  customerA2: "22222222-aaaa-4222-8222-222222222222",
  customerB1: "33333333-bbbb-4333-8333-333333333333",
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
        ${workspaceId}::uuid, ${userId}::uuid, 'Cust DB A', 'Cust DB A LLC',
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
    await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid`;
    await tx`delete from app.memberships where id = ${membershipId}::uuid`;
    await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
    await tx`delete from app.app_users where id = ${userId}::uuid`;
  });
}

test("customers table has FORCE RLS", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    const rows = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relname = 'customers'
    `;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.relrowsecurity, true);
    assert.equal(rows[0]?.relforcerowsecurity, true);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("customers RLS isolation, duplicate email, archive, version, and connection reuse", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await cleanupTenant(sql, F.authA, F.userA, F.workspaceA, F.membershipA);
    await cleanupTenant(sql, F.authB, F.userB, F.workspaceB, F.membershipB);
    await seedTenant(sql, F.authA, F.emailA, F.userA, F.workspaceA, F.membershipA);
    await seedTenant(sql, F.authB, F.emailB, F.userB, F.workspaceB, F.membershipB);

    // No context → zero protected rows
    const none = await sql<{ n: number }[]>`select count(*)::int as n from app.customers`;
    assert.equal(Number(none[0]?.n ?? -1), 0);

    // Own-workspace insert succeeds
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      await tx`
        insert into app.customers (
          id, workspace_id, name, email, normalized_email, phone,
          billing_address_json, version, created_by
        ) values (
          ${F.customerA1}::uuid, ${F.workspaceA}::uuid, 'Alpha Contact',
          'dup@example.test', 'dup@example.test', '+15551234567',
          null, 1, ${F.userA}::uuid
        )
      `;
      const own = await tx<{ id: string; version: number; archived_at: string | null }[]>`
        select id::text as id, version, archived_at::text as archived_at
        from app.customers
        where id = ${F.customerA1}::uuid
      `;
      assert.equal(own.length, 1);
      assert.equal(own[0]?.version, 1);
      assert.equal(own[0]?.archived_at, null);
    });

    // Cross-workspace insert blocked
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`
            insert into app.customers (
              id, workspace_id, name, email, normalized_email, created_by
            ) values (
              ${F.customerB1}::uuid, ${F.workspaceB}::uuid, 'Spoof',
              null, null, ${F.userA}::uuid
            )
          `;
        }),
      (error: unknown) => error instanceof Error,
    );

    // Seed B customer under B context
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceB}, true)`;
      await tx`
        insert into app.customers (
          id, workspace_id, name, email, normalized_email, created_by
        ) values (
          ${F.customerB1}::uuid, ${F.workspaceB}::uuid, 'Beta Contact',
          'beta@example.test', 'beta@example.test', ${F.userB}::uuid
        )
      `;
    });

    // Own select / cross select hidden
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const visible = await tx<{ id: string }[]>`select id::text as id from app.customers`;
      assert.equal(visible.length, 1);
      assert.equal(visible[0]?.id, F.customerA1);
      const foreign = await tx<{ n: number }[]>`
        select count(*)::int as n from app.customers where id = ${F.customerB1}::uuid
      `;
      assert.equal(Number(foreign[0]?.n ?? -1), 0);
    });

    // Own update succeeds; cross-workspace update blocked
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const updated = await tx<{ name: string }[]>`
        update app.customers
        set name = 'Alpha Updated'
        where id = ${F.customerA1}::uuid
        returning name
      `;
      assert.equal(updated[0]?.name, "Alpha Updated");
      const cross = await tx<{ n: number }[]>`
        update app.customers
        set name = 'Hijack'
        where id = ${F.customerB1}::uuid
      `;
      assert.equal(cross.count, 0);
    });

    // Workspace reassignment blocked
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`
            update app.customers
            set workspace_id = ${F.workspaceB}::uuid
            where id = ${F.customerA1}::uuid
          `;
        }),
      (error: unknown) => error instanceof Error,
    );

    // Cross-workspace delete blocked
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const deleted = await tx`
        delete from app.customers where id = ${F.customerB1}::uuid
      `;
      assert.equal(deleted.count, 0);
    });

    // Duplicate normalized email allowed in same workspace (CUS01)
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      await tx`
        insert into app.customers (
          id, workspace_id, name, email, normalized_email, created_by
        ) values (
          ${F.customerA2}::uuid, ${F.workspaceA}::uuid, 'Other Name Same Email',
          'dup@example.test', 'dup@example.test', ${F.userA}::uuid
        )
      `;
      const dups = await tx<{ n: number }[]>`
        select count(*)::int as n
        from app.customers
        where normalized_email = 'dup@example.test'
      `;
      assert.equal(Number(dups[0]?.n ?? -1), 2);
    });

    // Archive persistence
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const archived = await tx<{ archived_at: string | null }[]>`
        update app.customers
        set archived_at = now()
        where id = ${F.customerA2}::uuid
        returning archived_at::text as archived_at
      `;
      assert.ok(archived[0]?.archived_at);
      const stillActive = await tx<{ archived_at: string | null }[]>`
        select archived_at::text as archived_at from app.customers where id = ${F.customerA1}::uuid
      `;
      assert.equal(stillActive[0]?.archived_at, null);
    });

    // Version default / invalid version rejected
    await assert.rejects(
      () =>
        sql.begin(async (tx) => {
          await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
          await tx`
            insert into app.customers (
              id, workspace_id, name, version, created_by
            ) values (
              '99999999-aaaa-4999-8999-999999999999'::uuid,
              ${F.workspaceA}::uuid, 'Bad Version', 0, ${F.userA}::uuid
            )
          `;
        }),
      (error: unknown) => error instanceof Error,
    );

    // Connection reuse: after A transaction, no leak
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceA}, true)`;
      const n = await tx<{ n: number }[]>`select count(*)::int as n from app.customers`;
      assert.ok(Number(n[0]?.n ?? 0) >= 1);
    });
    const leakedGuc = await sql<{ workspace_id: string }[]>`
      select current_setting('app.workspace_id', true) as workspace_id
    `;
    assert.notEqual(leakedGuc[0]?.workspace_id, F.workspaceA);
    const leakedRows = await sql<{ n: number }[]>`select count(*)::int as n from app.customers`;
    assert.equal(Number(leakedRows[0]?.n ?? -1), 0);

    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${F.workspaceB}, true)`;
      const onlyB = await tx<{ id: string }[]>`select id::text as id from app.customers`;
      assert.equal(onlyB.length, 1);
      assert.equal(onlyB[0]?.id, F.customerB1);
    });
  } finally {
    try {
      await cleanupTenant(sql, F.authA, F.userA, F.workspaceA, F.membershipA);
      await cleanupTenant(sql, F.authB, F.userB, F.workspaceB, F.membershipB);
    } catch {
      // best-effort cleanup
    }
    await sql.end({ timeout: 5 });
  }
});
