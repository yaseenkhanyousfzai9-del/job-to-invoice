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

const ISSUER = "http://auth.test/cust-api-03-detail/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Cust Detail Live ${suffix}`,
    legal_name: `Cust Detail Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `detail-${suffix}@example.test`,
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
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
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

test("live GET /v1/customers/{id} detail isolation on US development", {
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

  const authA = "cust-api-03-detail-auth-a";
  const authB = "cust-api-03-detail-auth-b";

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

    const accessA = await token(authA, "detail-a@example.test");
    const accessB = await token(authB, "detail-b@example.test");

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

    const createdA = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Live Detail A", email: "live-a@example.test" },
    });
    assert.equal(createdA.statusCode, 201);
    const customerA = (createdA.json() as { data: { id: string; name: string } }).data;

    const createdB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Live Detail B", email: "live-b@example.test" },
    });
    assert.equal(createdB.statusCode, 201);
    const customerB = (createdB.json() as { data: { id: string; name: string } }).data;

    const own = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerA.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(own.statusCode, 200);
    const ownBody = own.json() as { data: Record<string, unknown> };
    assert.equal(ownBody.data["name"], "Live Detail A");
    assert.equal("workspace_id" in ownBody.data, false);
    assert.equal("normalized_email" in ownBody.data, false);
    assert.equal("created_by" in ownBody.data, false);

    const foreign = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerB.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(foreign.statusCode, 404);
    const foreignBody = foreign.json() as { error: { code: string; message: string } };
    assert.equal(foreignBody.error.code, "NOT_FOUND");
    assert.equal(JSON.stringify(foreignBody).includes(customerB.name), false);

    const unknown = await app.inject({
      method: "GET",
      url: `/v1/customers/${uuidFromSeed(99)}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(unknown.statusCode, 404);
    const unknownBody = unknown.json() as { error: { code: string; message: string } };
    assert.equal(unknownBody.error.message, foreignBody.error.message);
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await store.close?.();
    await app.close();
    await sql.end({ timeout: 5 });
  }
});
