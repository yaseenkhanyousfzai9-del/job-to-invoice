import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createPostgresAuthStore } from "./store/postgres.ts";

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

const ISSUER = "http://auth.test/cust-api-02/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Cust List Live ${suffix}`,
    legal_name: `Cust List Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `list-${suffix}@example.test`,
    contact_phone: null,
    address: {
      line1: "100 Main St",
      line2: null,
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    timezone: "America/Chicago",
    trade: "handyman",
    default_tax_bp: 0,
    default_due_days: 14,
    default_terms: "",
  };
}

function uuidFromSeed(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `cccccccc-cccc-4ccc-8ccc-${hex}`;
}

async function cleanupOwner(sql: ReturnType<typeof postgres>, authUserId: string): Promise<void> {
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
      await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.job_allowances where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.memberships where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
    }
    await tx`delete from app.idempotency_records where actor_scope = ${userId}`;
    await tx`delete from app.app_users where id = ${userId}::uuid`;
  });
}

test("live GET /v1/customers lists, searches, and isolates tenants", {
  skip: databaseUrl === undefined,
}, async () => {
  assert.ok(databaseUrl, "DATABASE_URL_API required for live evidence");
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const store = createPostgresAuthStore(databaseUrl);
  const app = await buildApp({
    jwtVerifier: createStaticKeyVerifier({
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
    store,
  });

  const authA = "cust-api-02-live-auth-a";
  const authB = "cust-api-02-live-auth-b";

  async function token(subject: string, email: string) {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }

  try {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);

    const accessA = await token(authA, "list-a@example.test");
    const accessB = await token(authB, "list-b@example.test");

    await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(1) },
      payload: workspaceBody("a"),
    });
    await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(2) },
      payload: workspaceBody("b"),
    });

    const created = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Android Network Test Live", email: "android-live@example.test" },
    });
    assert.equal(created.statusCode, 201);

    await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Other Tenant Android" },
    });

    const list = await app.inject({
      method: "GET",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(list.statusCode, 200);
    const listBody = list.json() as {
      data: { items: { name: string; workspace_id?: string; normalized_email?: string }[]; next_cursor: null };
    };
    assert.equal(listBody.data.items.length, 1);
    assert.equal(listBody.data.items[0]?.name, "Android Network Test Live");
    assert.equal(listBody.data.items[0]?.workspace_id, undefined);
    assert.equal(listBody.data.items[0]?.normalized_email, undefined);

    const search = await app.inject({
      method: "GET",
      url: "/v1/customers?search=Android",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(search.statusCode, 200);
    assert.equal((search.json() as { data: { items: unknown[] } }).data.items.length, 1);

    const other = await app.inject({
      method: "GET",
      url: "/v1/customers?search=Android",
      headers: { authorization: `Bearer ${accessB}` },
    });
    assert.equal((other.json() as { data: { items: { name: string }[] } }).data.items.length, 1);
    assert.equal(
      (other.json() as { data: { items: { name: string }[] } }).data.items[0]?.name,
      "Other Tenant Android",
    );
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await store.close?.();
    await app.close();
    await sql.end({ timeout: 5 });
  }
});
