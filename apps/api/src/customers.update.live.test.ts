import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createPostgresAuthStore } from "./store/postgres.ts";
import {
  cleanupDisposableOwnerByAuth,
  liveDevelopmentApiUrl,
} from "./test-helpers/customerLiveFixtures.ts";

const databaseUrl = liveDevelopmentApiUrl();

const ISSUER = "http://auth.test/cust-api-04/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Cust API04 Live ${suffix}`,
    legal_name: `Cust API04 Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `live-api04-${suffix}@example.test`,
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
  return `dddddddd-dddd-4ddd-8ddd-${hex}`;
}

test("live PATCH /v1/customers/{id} version, stale, cross-tenant, duplicate, idempotency", {
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

  const authA = "cust-api-04-live-auth-a";
  const authB = "cust-api-04-live-auth-b";

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
    await cleanupDisposableOwnerByAuth(sql, authA);
    await cleanupDisposableOwnerByAuth(sql, authB);

    const accessA = await token(authA, "api04-a@example.test");
    const accessB = await token(authB, "api04-b@example.test");

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

    const createA = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Live Patch Target", email: "live-target@example.test" },
    });
    assert.equal(createA.statusCode, 201);
    const customerA = (createA.json() as { data: { id: string; version: number; name: string } })
      .data;
    assert.equal(customerA.version, 1);

    const createDup = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Live Other", email: "live-other@example.test" },
    });
    assert.equal(createDup.statusCode, 201);
    const otherA = (createDup.json() as { data: { id: string; version: number } }).data;

    const createB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(5) },
      payload: { name: "Tenant B Customer", email: "live-b@example.test" },
    });
    assert.equal(createB.statusCode, 201);
    const customerB = (createB.json() as { data: { id: string } }).data;

    const detailBefore = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerA.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(detailBefore.statusCode, 200);
    assert.equal((detailBefore.json() as { data: { version: number } }).data.version, 1);

    const docsBefore = await sql<{ exists: boolean }[]>`
      select to_regclass('app.documents') is not null as exists
    `;
    assert.equal(docsBefore[0]?.exists, false);

    const patchOk = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerA.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(6),
        "if-match": "1",
      },
      payload: { name: "Live Patched Name" },
    });
    assert.equal(
      patchOk.statusCode,
      200,
      `expected 200 patch, got ${patchOk.statusCode}: ${patchOk.body}`,
    );
    const patched = (patchOk.json() as { data: { name: string; version: number; email: string } })
      .data;
    assert.equal(patched.name, "Live Patched Name");
    assert.equal(patched.email, "live-target@example.test");
    assert.equal(patched.version, 2);

    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerA.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(7),
        "if-match": "1",
      },
      payload: { name: "Should Not Stick" },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((stale.json() as { error: { code: string } }).error.code, "VERSION_CONFLICT");

    const afterStale = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerA.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal((afterStale.json() as { data: { name: string; version: number } }).data.name, "Live Patched Name");
    assert.equal((afterStale.json() as { data: { version: number } }).data.version, 2);

    const cross = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerB.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
        "if-match": "1",
      },
      payload: { name: "Cross Tenant" },
    });
    assert.equal(cross.statusCode, 404);
    assert.equal((cross.json() as { error: { code: string } }).error.code, "NOT_FOUND");

    const dupWarn = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${otherA.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(9),
        "if-match": "1",
      },
      payload: { email: "live-target@example.test" },
    });
    assert.equal(dupWarn.statusCode, 409);
    assert.equal(
      (dupWarn.json() as { error: { code: string } }).error.code,
      "DUPLICATE_CUSTOMER_EMAIL",
    );

    const dupConfirm = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${otherA.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(10),
        "if-match": "1",
      },
      payload: { email: "live-target@example.test", confirm_duplicate_email: true },
    });
    assert.equal(dupConfirm.statusCode, 200);
    assert.equal((dupConfirm.json() as { data: { version: number } }).data.version, 2);

    const idemKey = uuidFromSeed(11);
    const idemFirst = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerA.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": idemKey,
        "if-match": "2",
      },
      payload: { phone: "+15550001111" },
    });
    assert.equal(idemFirst.statusCode, 200);
    assert.equal((idemFirst.json() as { data: { version: number } }).data.version, 3);

    const idemReplay = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customerA.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": idemKey,
        "if-match": "2",
      },
      payload: { phone: "+15550001111" },
    });
    assert.equal(idemReplay.statusCode, 200);
    assert.equal((idemReplay.json() as { data: { version: number } }).data.version, 3);

    const docsAfter = await sql<{ exists: boolean }[]>`
      select to_regclass('app.documents') is not null as exists
    `;
    assert.equal(docsAfter[0]?.exists, false);
  } finally {
    await cleanupDisposableOwnerByAuth(sql, authA);
    await cleanupDisposableOwnerByAuth(sql, authB);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
