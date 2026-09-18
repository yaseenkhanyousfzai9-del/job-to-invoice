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

const ISSUER = "http://auth.test/cust-api-01/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Cust API Live ${suffix}`,
    legal_name: `Cust API Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `live-${suffix}@example.test`,
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
  return `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
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

test("live POST /v1/customers persists with idempotency and tenant isolation", {
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

  const authA = "cust-api-01-live-auth-a";
  const authB = "cust-api-01-live-auth-b";

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

    const accessA = await token(authA, "cust-api-01-a@example.test");
    const accessB = await token(authB, "cust-api-01-b@example.test");

    const wsA = await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(1),
      },
      payload: workspaceBody("A"),
    });
    assert.equal(wsA.statusCode, 200);
    const workspaceA = wsA.json().data.workspace.id as string;
    const userA = (
      await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${accessA}` },
      })
    ).json().data.user.id as string;

    const wsB = await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: {
        authorization: `Bearer ${accessB}`,
        "idempotency-key": uuidFromSeed(2),
      },
      payload: workspaceBody("B"),
    });
    assert.equal(wsB.statusCode, 200);

    const createA = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(3),
      },
      payload: {
        name: "Live Alpha",
        email: "Live.Alpha@Example.TEST",
        phone: "+15557654321",
      },
    });
    assert.equal(createA.statusCode, 201);
    const customerAId = createA.json().data.id as string;
    assert.equal(createA.json().data.version, 1);
    assert.equal(createA.json().data.archived_at, null);
    assert.equal(createA.json().data.email, "Live.Alpha@Example.TEST");

    const replay = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(3),
      },
      payload: {
        name: "Live Alpha",
        email: "Live.Alpha@Example.TEST",
        phone: "+15557654321",
      },
    });
    assert.equal(replay.statusCode, 201);
    assert.equal(replay.json().data.id, customerAId);

    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(3),
      },
      payload: { name: "Changed" },
    });
    assert.equal(mismatch.statusCode, 409);
    assert.equal(mismatch.json().error.code, "IDEMPOTENCY_MISMATCH");

    const rowsA = await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${workspaceA}, true)`;
      return tx<
        {
          id: string;
          workspace_id: string;
          normalized_email: string | null;
          created_by: string;
          version: number;
          archived_at: string | null;
        }[]
      >`
        select id, workspace_id, normalized_email, created_by, version, archived_at
        from app.customers
        where workspace_id = ${workspaceA}::uuid
      `;
    });
    assert.equal(rowsA.length, 1);
    assert.equal(rowsA[0]?.id, customerAId);
    assert.equal(rowsA[0]?.workspace_id, workspaceA);
    assert.equal(rowsA[0]?.normalized_email, "live.alpha@example.test");
    assert.equal(rowsA[0]?.created_by, userA);
    assert.equal(rowsA[0]?.version, 1);
    assert.equal(rowsA[0]?.archived_at, null);

    const warn = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(4),
      },
      payload: { name: "Live Alpha Two", email: "live.alpha@example.test" },
    });
    assert.equal(warn.statusCode, 409);
    assert.equal(warn.json().error.code, "DUPLICATE_CUSTOMER_EMAIL");

    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(5),
      },
      payload: {
        name: "Live Alpha Two",
        email: "live.alpha@example.test",
        confirm_duplicate_email: true,
      },
    });
    assert.equal(confirmed.statusCode, 201);

    const countA = await sql.begin(async (tx) => {
      await tx`select set_config('app.workspace_id', ${workspaceA}, true)`;
      return tx<{ n: number }[]>`
        select count(*)::int as n from app.customers
        where workspace_id = ${workspaceA}::uuid
          and normalized_email = 'live.alpha@example.test'
      `;
    });
    assert.equal(Number(countA[0]?.n), 2);

    const inB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessB}`,
        "idempotency-key": uuidFromSeed(6),
      },
      payload: { name: "Live Beta", email: "live.alpha@example.test" },
    });
    assert.equal(inB.statusCode, 201);

    const spoof = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessB}`,
        "idempotency-key": uuidFromSeed(7),
      },
      payload: {
        name: "Spoof",
        workspace_id: workspaceA,
        created_by: userA,
      },
    });
    assert.equal(spoof.statusCode, 422);
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
