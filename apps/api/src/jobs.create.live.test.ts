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

const ISSUER = "http://auth.test/cust-job-01-create/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Jobs Create Live ${suffix}`,
    legal_name: `Jobs Create Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `jobs-create-${suffix}@example.test`,
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
  return `eeeeeeee-eeee-4eee-8eee-${hex}`;
}

function siteAddress() {
  return {
    line1: "900 Live Site",
    line2: null,
    city: "Austin",
    state: "TX",
    zip: "78704",
  };
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

test("live POST /v1/jobs create, list, idempotency, archived, cross-tenant on US development", {
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

  const authA = "cust-job-01-create-auth-a";
  const authB = "cust-job-01-create-auth-b";

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

    const accessA = await token(authA, "jobs-create-a@example.test");
    const accessB = await token(authB, "jobs-create-b@example.test");

    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workspace",
          headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(1) },
          payload: workspaceBody("a"),
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/workspace",
          headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(2) },
          payload: workspaceBody("b"),
        })
      ).statusCode,
      200,
    );

    const meA = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessA}` },
    });
    const ownerA = (meA.json() as {
      data: { user: { id: string }; workspace: { id: string } };
    }).data;

    const customerRes = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Live Create Job Cust" },
    });
    assert.equal(customerRes.statusCode, 201);
    const customer = (customerRes.json() as { data: { id: string } }).data;

    const foreignRes = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Foreign Live Cust" },
    });
    assert.equal(foreignRes.statusCode, 201);
    const foreign = (foreignRes.json() as { data: { id: string } }).data;

    const jobPayload = {
      id: uuidFromSeed(10),
      customer_id: customer.id,
      title: "Live Create Job",
      no_site: false,
      site_address: siteAddress(),
      mode: "quote" as const,
    };

    const created = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(5) },
      payload: jobPayload,
    });
    assert.equal(created.statusCode, 201);
    const job = (created.json() as { data: Record<string, unknown> }).data;
    assert.equal(job["id"], uuidFromSeed(10));
    assert.equal(job["customer_id"], customer.id);
    assert.equal(job["lifecycle"], "draft");
    assert.equal(job["version"], 1);
    assert.equal(job["scope_version"], 0);
    assert.equal(job["workspace_id"], undefined);
    assert.equal(job["created_by"], undefined);
    assert.equal(job["internal_notes"], undefined);

    const dbRows = await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authA}, true)`;
      await tx`select set_config('app.workspace_id', ${ownerA.workspace.id}, true)`;
      return tx<{
        lifecycle: string;
        version: number;
        scope_version: number;
        no_site: boolean;
        workspace_id: string;
      }[]>`
        select lifecycle, version, scope_version, no_site, workspace_id
        from app.jobs
        where id = ${uuidFromSeed(10)}::uuid
      `;
    });
    assert.equal(dbRows.length, 1);
    assert.equal(dbRows[0]?.lifecycle, "draft");
    assert.equal(dbRows[0]?.version, 1);
    assert.equal(dbRows[0]?.scope_version, 0);
    assert.equal(dbRows[0]?.no_site, false);
    assert.equal(dbRows[0]?.workspace_id, ownerA.workspace.id);

    const list = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${customer.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(list.statusCode, 200);
    const items = (list.json() as { data: { items: { id: string }[] } }).data.items;
    assert.equal(items.some((row) => row.id === uuidFromSeed(10)), true);

    const replay = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(5) },
      payload: jobPayload,
    });
    assert.equal(replay.statusCode, 201);
    assert.equal((replay.json() as { data: { id: string } }).data.id, uuidFromSeed(10));

    const countAfterReplay = await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authA}, true)`;
      await tx`select set_config('app.workspace_id', ${ownerA.workspace.id}, true)`;
      return tx<{ n: string }[]>`
        select count(*)::text as n from app.jobs
        where workspace_id = ${ownerA.workspace.id}::uuid
          and customer_id = ${customer.id}::uuid
      `;
    });
    assert.equal(countAfterReplay[0]?.n, "1");

    const mismatch = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(5) },
      payload: { ...jobPayload, title: "Changed title" },
    });
    assert.equal(mismatch.statusCode, 409);
    assert.equal((mismatch.json() as { error: { code: string } }).error.code, "IDEMPOTENCY_MISMATCH");

    const cross = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(6) },
      payload: {
        id: uuidFromSeed(11),
        customer_id: foreign.id,
        title: "Cross",
        no_site: true,
        mode: "quote",
      },
    });
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(7) },
      payload: {
        id: uuidFromSeed(12),
        customer_id: uuidFromSeed(99),
        title: "Unknown",
        no_site: true,
        mode: "quote",
      },
    });
    assert.equal(cross.statusCode, 404);
    assert.equal(unknown.statusCode, 404);
    assert.equal(
      (cross.json() as { error: { code: string; message: string } }).error.code,
      (unknown.json() as { error: { code: string; message: string } }).error.code,
    );

    const archivedCust = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(8) },
      payload: { name: "Archived Live Cust" },
    });
    assert.equal(archivedCust.statusCode, 201);
    const archivedId = (archivedCust.json() as { data: { id: string } }).data.id;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/customers/${archivedId}/archive`,
          headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(9) },
          payload: { archived: true },
        })
      ).statusCode,
      200,
    );
    const archivedCreate = await app.inject({
      method: "POST",
      url: "/v1/jobs",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(13) },
      payload: {
        id: uuidFromSeed(14),
        customer_id: archivedId,
        title: "Should fail",
        no_site: true,
        mode: "quote",
      },
    });
    assert.equal(archivedCreate.statusCode, 422);
    assert.equal(
      (archivedCreate.json() as { error: { code: string } }).error.code,
      "CUSTOMER_ARCHIVED",
    );
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await store.close?.();
    await sql.end({ timeout: 5 });
    await app.close();
  }
});
