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

const ISSUER = "http://auth.test/cust-api-03-jobs/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Jobs List Live ${suffix}`,
    legal_name: `Jobs List Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `jobs-${suffix}@example.test`,
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

test("live GET /v1/jobs?customer_id= associates and isolates on US development", {
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

  const authA = "cust-api-03-jobs-auth-a";
  const authB = "cust-api-03-jobs-auth-b";

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

    const accessA = await token(authA, "jobs-a@example.test");
    const accessB = await token(authB, "jobs-b@example.test");

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

    const meA = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessA}` },
    });
    const meB = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessB}` },
    });
    const ownerA = (meA.json() as {
      data: { user: { id: string }; workspace: { id: string } };
    }).data;
    const ownerB = (meB.json() as {
      data: { user: { id: string }; workspace: { id: string } };
    }).data;

    const c1 = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Jobs Cust 1" },
    });
    const c2 = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Jobs Cust 2" },
    });
    const cB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(5) },
      payload: { name: "Jobs Cust B" },
    });
    assert.equal(c1.statusCode, 201);
    assert.equal(c2.statusCode, 201);
    assert.equal(cB.statusCode, 201);
    const customer1 = (c1.json() as { data: { id: string } }).data;
    const customer2 = (c2.json() as { data: { id: string } }).data;
    const customerB = (cB.json() as { data: { id: string; name: string } }).data;

    await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authA}, true)`;
      await tx`select set_config('app.workspace_id', ${ownerA.workspace.id}, true)`;
      await tx`
        insert into app.jobs (id, workspace_id, customer_id, title, created_by, updated_at)
        values
          (${uuidFromSeed(10)}::uuid, ${ownerA.workspace.id}::uuid, ${customer1.id}::uuid,
           'Live Job Newer', ${ownerA.user.id}::uuid, '2026-09-19T12:00:00Z'::timestamptz),
          (${uuidFromSeed(11)}::uuid, ${ownerA.workspace.id}::uuid, ${customer1.id}::uuid,
           'Live Job Older', ${ownerA.user.id}::uuid, '2026-09-18T12:00:00Z'::timestamptz),
          (${uuidFromSeed(12)}::uuid, ${ownerA.workspace.id}::uuid, ${customer2.id}::uuid,
           'Other Customer Live', ${ownerA.user.id}::uuid, '2026-09-20T12:00:00Z'::timestamptz)
      `;
    });
    await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authB}, true)`;
      await tx`select set_config('app.workspace_id', ${ownerB.workspace.id}, true)`;
      await tx`
        insert into app.jobs (id, workspace_id, customer_id, title, created_by)
        values (
          ${uuidFromSeed(13)}::uuid, ${ownerB.workspace.id}::uuid, ${customerB.id}::uuid,
          'Tenant B Secret Job', ${ownerB.user.id}::uuid
        )
      `;
    });

    const empty = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${customer2.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    // customer2 has one job — use a fresh customer for empty proof
    const emptyCust = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(6) },
      payload: { name: "No Jobs Live" },
    });
    const emptyCustomer = (emptyCust.json() as { data: { id: string } }).data;
    const emptyJobs = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${emptyCustomer.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(emptyJobs.statusCode, 200);
    assert.deepEqual((emptyJobs.json() as { data: { items: unknown[] } }).data.items, []);

    const associated = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${customer1.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(associated.statusCode, 200);
    const associatedBody = associated.json() as {
      data: { items: Array<Record<string, unknown>> };
    };
    assert.equal(associatedBody.data.items.length, 2);
    assert.equal(associatedBody.data.items[0]?.["title"], "Live Job Newer");
    assert.equal(associatedBody.data.items[1]?.["title"], "Live Job Older");
    assert.equal(
      associatedBody.data.items.some((item) => item["title"] === "Other Customer Live"),
      false,
    );
    assert.equal(
      associatedBody.data.items.some((item) => item["title"] === "Tenant B Secret Job"),
      false,
    );
    for (const item of associatedBody.data.items) {
      assert.equal("workspace_id" in item, false);
      assert.equal("created_by" in item, false);
      assert.equal("internal_notes" in item, false);
    }

    // customer2 jobs exist but must not appear under customer1 (already checked);
    // and must still be readable for customer2.
    void empty;
    const otherOwn = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${customer2.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(otherOwn.statusCode, 200);
    const otherBody = otherOwn.json() as { data: { items: Array<{ title: string }> } };
    assert.equal(otherBody.data.items.length, 1);
    assert.equal(otherBody.data.items[0]?.title, "Other Customer Live");

    const foreign = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${customerB.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(foreign.statusCode, 404);
    const foreignBody = foreign.json() as { error: { code: string; message: string } };
    assert.equal(foreignBody.error.code, "NOT_FOUND");
    assert.equal(JSON.stringify(foreignBody).includes("Tenant B Secret Job"), false);
    assert.equal(JSON.stringify(foreignBody).includes(customerB.name), false);

    const unknown = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${uuidFromSeed(99)}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(unknown.statusCode, 404);
    const unknownBody = unknown.json() as { error: { message: string } };
    assert.equal(unknownBody.error.message, foreignBody.error.message);
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await store.close?.();
    await app.close();
    await sql.end({ timeout: 5 });
  }
});
