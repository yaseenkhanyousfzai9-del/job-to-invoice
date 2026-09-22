/**
 * Customer error-contract live smoke — Development US only.
 * Covers: duplicate 409, VERSION_CONFLICT, CUSTOMER_REFERENCED, cross-tenant 404.
 * Disposable fixtures cleaned in finally.
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

async function cleanupOwner(
  sql: ReturnType<typeof postgres>,
  authUserId: string,
): Promise<void> {
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

  const runId = randomUUID().slice(0, 8);
  const authA = `ec-smoke-a-${runId}`;
  const authB = `ec-smoke-b-${runId}`;
  const emailA = `ec-smoke-a-${runId}@example.test`;
  const emailB = `ec-smoke-b-${runId}@example.test`;

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

    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workspace",
          headers: {
            authorization: `Bearer ${accessA}`,
            "idempotency-key": randomUUID(),
          },
          payload: workspaceBody(`${runId}a`),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workspace",
          headers: {
            authorization: `Bearer ${accessB}`,
            "idempotency-key": randomUUID(),
          },
          payload: workspaceBody(`${runId}b`),
        })
      ).statusCode,
      200,
    );

    const meA = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(meA.statusCode, 200);

    const primary = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `EC Primary ${runId}`,
        email: `ec-dup-${runId}@example.test`,
        phone: null,
        billing_address: null,
        confirm_duplicate_email: false,
      },
    });
    assert.equal(primary.statusCode, 201);
    const customer = (primary.json() as { data: CustomerPublic }).data;
    assertCustomerPublicDto(customer);

    const dup = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `EC Dup ${runId}`,
        email: `ec-dup-${runId}@example.test`,
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
      payload: { name: `EC Primary Edited ${runId}` },
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
    assertCustomerPublicDto(
      (stale.json() as { error: { details: { server: CustomerPublic } } }).error.details.server,
    );

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
        title: `EC Job ${runId}`,
        no_site: true,
        mode: "quote",
      },
    });
    assert.equal(job.statusCode, 201, job.body);

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
    assert.equal(/23503/.test(referenced.body), false);

    const foreign = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${accessB}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `EC Foreign ${runId}`,
        email: null,
        phone: null,
        billing_address: null,
      },
    });
    assert.equal(foreign.statusCode, 201);
    const foreignId = (foreign.json() as { data: { id: string } }).data.id;

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
      (unknownGet.json() as { error: { code: string; message: string } }).error.code,
      (crossGet.json() as { error: { code: string; message: string } }).error.code,
    );
    assert.equal(
      (unknownGet.json() as { error: { message: string } }).error.message,
      (crossGet.json() as { error: { message: string } }).error.message,
    );
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
