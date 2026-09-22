/**
 * Customer Module Release Gate — disposable live smoke on Development US only.
 * Exact-ID tracking + finally cleanup. Skips without DATABASE_URL_API.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import postgres from "postgres";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createPostgresAuthStore } from "./store/postgres.ts";
import {
  assertCustomerPublicDto,
  type CustomerPublic,
} from "./test-helpers/customerFixtures.ts";
import {
  CustomerFixtureScope,
  finalizeCustomerLiveScope,
  liveDevelopmentApiUrl,
} from "./test-helpers/customerLiveFixtures.ts";

const databaseUrl = liveDevelopmentApiUrl();
const ISSUER = "http://auth.test/customer-release-gate-live/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `RG Smoke ${suffix}`,
    legal_name: `RG Smoke ${suffix} LLC`,
    contact_name: "RG Smoke Owner",
    contact_email: `rg-smoke-${suffix}@example.test`,
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

test("Customer release gate live smoke: create detail edit archive restore delete", {
  skip: databaseUrl === undefined,
}, async () => {
  assert.ok(databaseUrl, "DATABASE_URL_API required for live smoke");
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

  const scope = new CustomerFixtureScope();
  const authSubject = `rg-smoke-${scope.runId}`;
  const email = `rg-smoke-${scope.runId}@example.test`;
  scope.trackAuth(authSubject);

  async function token(subject: string, subjectEmail: string) {
    return new SignJWT({ email: subjectEmail })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
  }

  try {
    const access = await token(authSubject, email);
    const workspace = await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
      },
      payload: workspaceBody(scope.runId),
    });
    assert.equal(workspace.statusCode, 200);
    const workspaceId = (workspace.json() as { data: { workspace: { id: string } } }).data
      .workspace.id;
    scope.trackWorkspace(workspaceId);

    const created = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `RG Smoke ${scope.runId}`,
        email: `rg-smoke-cust-${scope.runId}@example.test`,
        phone: null,
        billing_address: null,
        confirm_duplicate_email: false,
      },
    });
    assert.equal(created.statusCode, 201);
    const customer = (created.json() as { data: CustomerPublic }).data;
    assertCustomerPublicDto(customer);
    scope.trackCustomer(customer.id);

    const detail = await app.inject({
      method: "GET",
      url: `/v1/customers/${customer.id}`,
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(detail.statusCode, 200);

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customer.id}`,
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
        "if-match": String(customer.version),
      },
      payload: { name: `RG Smoke Edited ${scope.runId}` },
    });
    assert.equal(patched.statusCode, 200);
    const afterPatch = (patched.json() as { data: CustomerPublic }).data;
    assert.equal(afterPatch.version, customer.version + 1);

    const archived = await app.inject({
      method: "POST",
      url: `/v1/customers/${customer.id}/archive`,
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
      },
      payload: { archived: true },
    });
    assert.equal(archived.statusCode, 200);

    const restored = await app.inject({
      method: "POST",
      url: `/v1/customers/${customer.id}/archive`,
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
      },
      payload: { archived: false },
    });
    assert.equal(restored.statusCode, 200);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${customer.id}`,
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
      },
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual((deleted.json() as { data: unknown }).data, { deleted: true });
    // Deleted via API — still assert residual scope after owner cleanup.
  } finally {
    await finalizeCustomerLiveScope(sql, scope);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
