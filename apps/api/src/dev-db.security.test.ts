import assert from "node:assert/strict";
import { test } from "node:test";
import postgres from "postgres";
import { createConfiguredJwtVerifier } from "./auth/jwt.ts";

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

function liveJwksConfig(): {
  jwksUrl: string;
  issuer: string;
  audience: string;
} | undefined {
  if (process.env["APP_ENV"] === "production" || process.env["APP_ENV"] === "staging") {
    return undefined;
  }
  const jwksUrl = process.env["AUTH_JWKS_URL"]?.trim();
  const issuer = process.env["AUTH_ISSUER"]?.trim();
  const audience = process.env["AUTH_AUDIENCE"]?.trim() || "authenticated";
  if (!jwksUrl || !issuer) {
    return undefined;
  }
  return { jwksUrl, issuer, audience };
}

const databaseUrl = liveDevelopmentApiUrl();
const jwks = liveJwksConfig();

const FICTIONAL = {
  authA: "runtime-role-03-auth-a",
  authB: "runtime-role-03-auth-b",
  emailA: "runtime-role-03-a@example.test",
  emailB: "runtime-role-03-b@example.test",
  userA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  userB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceA: "11111111-1111-4111-8111-111111111111",
  workspaceB: "22222222-2222-4222-8222-222222222222",
  membershipA: "33333333-3333-4333-8333-333333333333",
  membershipB: "44444444-4444-4444-8444-444444444444",
  addressJson: JSON.stringify({
    line1: "1 Test St",
    city: "Austin",
    region: "TX",
    postal_code: "78701",
    country: "US",
  }),
} as const;

test("development API database role is app_api_login without superuser or BYPASSRLS", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    const rows = await sql<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      in_app_api: boolean;
    }[]>`
      select
        current_user as rolname,
        r.rolsuper,
        r.rolbypassrls,
        pg_has_role(current_user, 'app_api', 'member') as in_app_api
      from pg_roles r
      where r.rolname = current_user
    `;
    const role = rows[0];
    assert.ok(role);
    assert.equal(role.rolname, "app_api_login");
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    assert.equal(role.in_app_api, true);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("auth/workspace tenant tables have FORCE RLS", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app'
        and c.relkind = 'r'
        and c.relname in (
          'app_users',
          'workspaces',
          'memberships',
          'job_allowances',
          'idempotency_records'
        )
      order by c.relname
    `;
    assert.equal(rows.length, 5);
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} RLS`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} FORCE RLS`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("API role cannot escalate privileges or disable FORCE RLS", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await assert.rejects(
      () => sql.unsafe("set role postgres"),
      (error: unknown) => error instanceof Error,
    );
    await assert.rejects(
      () => sql.unsafe("alter role app_api_login with superuser"),
      (error: unknown) => error instanceof Error,
    );
    await assert.rejects(
      () => sql.unsafe("alter role app_api_login with bypassrls"),
      (error: unknown) => error instanceof Error,
    );
    await assert.rejects(
      () => sql.unsafe("create role runtime_role_03_evil with superuser login"),
      (error: unknown) => error instanceof Error,
    );
    await assert.rejects(
      () => sql.unsafe("alter table app.workspaces disable row level security"),
      (error: unknown) => error instanceof Error,
    );
    await assert.rejects(
      () => sql.unsafe("alter table app.workspaces no force row level security"),
      (error: unknown) => error instanceof Error,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("API role cannot read workspaces without transaction-local tenant context", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    const leaked = await sql<{ n: number }[]>`select count(*)::int as n from app.workspaces`;
    assert.equal(Number(leaked[0]?.n ?? -1), 0);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("workspace GUC does not leak across transactions on a pooled connection", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${FICTIONAL.workspaceA}, true)`;
      const inside = await tx<{ workspace_id: string }[]>`
        select current_setting('app.workspace_id', true) as workspace_id
      `;
      assert.equal(inside[0]?.workspace_id, FICTIONAL.workspaceA);
    });
    const after = await sql<{ workspace_id: string }[]>`
      select current_setting('app.workspace_id', true) as workspace_id
    `;
    assert.notEqual(after[0]?.workspace_id, FICTIONAL.workspaceA);
  } finally {
    await sql.end({ timeout: 5 });
  }
});

test("own-workspace readable and cross-tenant memberships inaccessible under RLS", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });

  async function seedTenant(
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
          ${workspaceId}::uuid, ${userId}::uuid, 'Runtime Role A', 'Runtime Role A LLC',
          'Owner', ${email}, ${FICTIONAL.addressJson}::jsonb, 'America/Chicago', 'USD',
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
    authUserId: string,
    userId: string,
    workspaceId: string,
    membershipId: string,
  ): Promise<void> {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authUserId}, true)`;
      await tx`select set_config('app.workspace_id', ${workspaceId}, true)`;
      await tx`delete from app.memberships where id = ${membershipId}::uuid`;
      await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
      await tx`delete from app.app_users where id = ${userId}::uuid`;
    });
  }

  try {
    await cleanupTenant(FICTIONAL.authA, FICTIONAL.userA, FICTIONAL.workspaceA, FICTIONAL.membershipA);
    await cleanupTenant(FICTIONAL.authB, FICTIONAL.userB, FICTIONAL.workspaceB, FICTIONAL.membershipB);

    await seedTenant(
      FICTIONAL.authA,
      FICTIONAL.emailA,
      FICTIONAL.userA,
      FICTIONAL.workspaceA,
      FICTIONAL.membershipA,
    );
    await seedTenant(
      FICTIONAL.authB,
      FICTIONAL.emailB,
      FICTIONAL.userB,
      FICTIONAL.workspaceB,
      FICTIONAL.membershipB,
    );

    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${FICTIONAL.workspaceA}, true)`;
      const own = await tx<{ id: string; workspace_id: string }[]>`
        select id::text as id, workspace_id::text as workspace_id
        from app.memberships
      `;
      assert.equal(own.length, 1);
      assert.equal(own[0]?.workspace_id, FICTIONAL.workspaceA);
      assert.equal(own[0]?.id, FICTIONAL.membershipA);

      const foreign = await tx<{ n: number }[]>`
        select count(*)::int as n
        from app.memberships
        where workspace_id = ${FICTIONAL.workspaceB}::uuid
      `;
      assert.equal(Number(foreign[0]?.n ?? -1), 0);
    });

    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${FICTIONAL.workspaceB}, true)`;
      const own = await tx<{ id: string }[]>`
        select id::text as id from app.memberships
      `;
      assert.equal(own.length, 1);
      assert.equal(own[0]?.id, FICTIONAL.membershipB);
    });

    // Connection reuse: after A transaction, bare connection has no prior workspace context.
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${FICTIONAL.workspaceA}, true)`;
      const visible = await tx<{ n: number }[]>`select count(*)::int as n from app.memberships`;
      assert.equal(Number(visible[0]?.n ?? -1), 1);
    });
    const leakedGuc = await sql<{ workspace_id: string }[]>`
      select current_setting('app.workspace_id', true) as workspace_id
    `;
    assert.notEqual(leakedGuc[0]?.workspace_id, FICTIONAL.workspaceA);
    const leakedRows = await sql<{ n: number }[]>`select count(*)::int as n from app.memberships`;
    assert.equal(Number(leakedRows[0]?.n ?? -1), 0);

    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${FICTIONAL.workspaceB}, true)`;
      const onlyB = await tx<{ id: string }[]>`select id::text as id from app.memberships`;
      assert.equal(onlyB.length, 1);
      assert.equal(onlyB[0]?.id, FICTIONAL.membershipB);
    });
  } finally {
    try {
      await cleanupTenant(FICTIONAL.authA, FICTIONAL.userA, FICTIONAL.workspaceA, FICTIONAL.membershipA);
      await cleanupTenant(FICTIONAL.authB, FICTIONAL.userB, FICTIONAL.workspaceB, FICTIONAL.membershipB);
    } catch {
      // best-effort cleanup of fictional fixtures
    }
    await sql.end({ timeout: 5 });
  }
});

test("development JWKS document is reachable", { skip: jwks === undefined }, async () => {
  const response = await fetch((jwks as { jwksUrl: string }).jwksUrl);
  assert.equal(response.ok, true);
  const body = (await response.json()) as { keys?: unknown };
  assert.ok(Array.isArray(body.keys) && body.keys.length > 0);
});

test("malformed bearer token is unauthorized against development JWKS", {
  skip: jwks === undefined,
}, async () => {
  const verifier = createConfiguredJwtVerifier(jwks as { jwksUrl: string; issuer: string; audience: string });
  await assert.rejects(() => verifier("Bearer not-a-jwt"), (error: unknown) => {
    return error instanceof Error && "statusCode" in error && (error as { statusCode: number }).statusCode === 401;
  });
});
