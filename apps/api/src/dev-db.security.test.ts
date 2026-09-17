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

test("development API database role is not superuser and cannot bypass RLS", {
  skip: databaseUrl === undefined,
}, async () => {
  const sql = postgres(databaseUrl as string, { max: 1, prepare: false });
  try {
    const rows = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select current_user as rolname, rolsuper, rolbypassrls
      from pg_roles
      where rolname = current_user
    `;
    const role = rows[0];
    assert.ok(role);
    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);
    assert.notEqual(role.rolname, "postgres");
    assert.notEqual(role.rolname, "supabase_admin");
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
  const fictionalWorkspace = "11111111-1111-4111-8111-111111111111";
  try {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${fictionalWorkspace}, true)`;
      const inside = await tx<{ workspace_id: string }[]>`
        select current_setting('app.workspace_id', true) as workspace_id
      `;
      assert.equal(inside[0]?.workspace_id, fictionalWorkspace);
    });
    const after = await sql<{ workspace_id: string }[]>`
      select current_setting('app.workspace_id', true) as workspace_id
    `;
    assert.notEqual(after[0]?.workspace_id, fictionalWorkspace);
  } finally {
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
