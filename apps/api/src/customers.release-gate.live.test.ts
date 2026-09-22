/**
 * Customer Module Release Gate — disposable live smoke on Development US only.
 * Creates and cleans unique fixtures. Skips without DATABASE_URL_API.
 * Never targets production / Tokyo.
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
      await tx`delete from app.customers where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.job_allowances where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.memberships where workspace_id = ${workspaceId}::uuid`;
      await tx`delete from app.workspaces where id = ${workspaceId}::uuid`;
    }
    await tx`delete from app.idempotency_records where actor_scope = ${userId}`;
    await tx`delete from app.app_users where id = ${userId}::uuid`;
  });
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

  const runId = randomUUID().slice(0, 8);
  const authSubject = `rg-smoke-${runId}`;
  const email = `rg-smoke-${runId}@example.test`;

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
      payload: workspaceBody(runId),
    });
    assert.equal(workspace.statusCode, 200);

    const created = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: {
        authorization: `Bearer ${access}`,
        "idempotency-key": randomUUID(),
      },
      payload: {
        name: `RG Smoke ${runId}`,
        email: `rg-smoke-cust-${runId}@example.test`,
        phone: null,
        billing_address: null,
        confirm_duplicate_email: false,
      },
    });
    assert.equal(created.statusCode, 201);
    const customer = (created.json() as { data: CustomerPublic }).data;
    assertCustomerPublicDto(customer);

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
      payload: { name: `RG Smoke Edited ${runId}` },
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
    assert.ok((archived.json() as { data: { archived_at: string | null } }).data.archived_at);

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
    assert.equal(
      (restored.json() as { data: { archived_at: string | null } }).data.archived_at,
      null,
    );

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

    const gone = await app.inject({
      method: "GET",
      url: `/v1/customers/${customer.id}`,
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(gone.statusCode, 404);
  } finally {
    await cleanupOwner(sql, authSubject);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
