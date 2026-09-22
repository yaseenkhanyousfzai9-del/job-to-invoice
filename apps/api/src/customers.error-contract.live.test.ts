/**
 * Customer error-contract live smoke — Development US only.
 * Exact-ID tracking + finally cleanup via CustomerFixtureScope.
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
const ISSUER = "http://auth.test/customer-error-contract-live/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `EC Smoke ${suffix}`,
    legal_name: `EC Smoke ${suffix} LLC`,
    contact_name: "EC Smoke Owner",
    contact_email: `ec-smoke-${suffix}@example.test`,
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

test("Customer error contract live: duplicate, VERSION_CONFLICT, referenced delete, cross-tenant 404", {
  skip: databaseUrl === undefined,
}, async () => {
  assert.ok(databaseUrl, "DATABASE_URL_API required for live error smoke");
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
  const authA = `ec-smoke-a-${scope.runId}`;
  const authB = `ec-smoke-b-${scope.runId}`;
  const emailA = `ec-smoke-a-${scope.runId}@example.test`;
  const emailB = `ec-smoke-b-${scope.runId}@example.test`;
  scope.trackAuth(authA);
  scope.trackAuth(authB);

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
    const accessA = await token(authA, emailA);
    const accessB = await token(authB, emailB);

    const wsA = await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
      payload: workspaceBody(`${scope.runId}a`),
    });
    assert.equal(wsA.statusCode, 200);
    scope.trackWorkspace((wsA.json() as { data: { workspace: { id: string } } }).data.workspace.id);

    const wsB = await app.inject({
      method: "POST",
      url: "/v1/workspace",
      headers: {
        authorization: `Bearer ${accessB}`,
        "idempotency-key": randomUUID(),
      },
      payload: workspaceBody(`${scope.runId}b`),
    });
    assert.equal(wsB.statusCode, 200);
    scope.trackWorkspace((wsB.json() as { data: { workspace: { id: string } } }).data.workspace.id);

    const primary = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `EC Primary ${scope.runId}`,
        email: `ec-dup-${scope.runId}@example.test`,
        phone: null,
        billing_address: null,
        confirm_duplicate_email: false,
      },
    });
    assert.equal(primary.statusCode, 201);
    const customer = (primary.json() as { data: CustomerPublic }).data;
    assertCustomerPublicDto(customer);
    scope.trackCustomer(customer.id);

    const dup = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `EC Dup ${scope.runId}`,
        email: `ec-dup-${scope.runId}@example.test`,
        phone: null,
        billing_address: null,
        confirm_duplicate_email: false,
      },
    });
    assert.equal(dup.statusCode, 409);
    assert.equal((dup.json() as { error: { code: string } }).error.code, "DUPLICATE_CUSTOMER_EMAIL");

    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customer.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
        "if-match": String(customer.version),
      },
      payload: { name: `EC Primary Edited ${scope.runId}` },
    });
    assert.equal(patched.statusCode, 200);

    const stale = await app.inject({
      method: "PATCH",
      url: `/v1/customers/${customer.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
        "if-match": String(customer.version),
      },
      payload: { name: "Stale Should Fail" },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal((stale.json() as { error: { code: string } }).error.code, "VERSION_CONFLICT");

    const jobId = randomUUID();
    const job = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        id: jobId,
        customer_id: customer.id,
        title: `EC Job ${scope.runId}`,
        no_site: true,
        mode: "quote",
      },
    });
    assert.equal(job.statusCode, 201, job.body);
    scope.trackJob(jobId);

    const referenced = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${customer.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
    });
    assert.equal(referenced.statusCode, 409);
    assert.equal(
      (referenced.json() as { error: { code: string } }).error.code,
      "CUSTOMER_REFERENCED",
    );

    const foreign = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessB}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `EC Foreign ${scope.runId}`,
        email: null,
        phone: null,
        billing_address: null,
      },
    });
    assert.equal(foreign.statusCode, 201);
    const foreignId = (foreign.json() as { data: { id: string } }).data.id;
    scope.trackCustomer(foreignId);

    const unknownId = "99999999-9999-4999-8999-999999999999";
    const unknownGet = await app.inject({
      method: "GET",
      url: `/v1/customers/${unknownId}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    const crossGet = await app.inject({
      method: "GET",
      url: `/v1/customers/${foreignId}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(unknownGet.statusCode, 404);
    assert.equal(crossGet.statusCode, 404);
    assert.equal(
      (unknownGet.json() as { error: { message: string } }).error.message,
      (crossGet.json() as { error: { message: string } }).error.message,
    );
  } finally {
    await finalizeCustomerLiveScope(sql, scope);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
