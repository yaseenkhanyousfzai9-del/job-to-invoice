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

const ISSUER = "http://auth.test/cust-api-06/v1";
const AUDIENCE = "authenticated";

function workspaceBody(suffix: string) {
  return {
    business_name: `Cust API06 Live ${suffix}`,
    legal_name: `Cust API06 Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `live-api06-${suffix}@example.test`,
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

function assertSafeErrorBody(body: string) {
  assert.equal(/23503/.test(body), false);
  assert.equal(/foreign key/i.test(body), false);
  assert.equal(/violates/i.test(body), false);
  assert.equal(/postgres/i.test(body), false);
  assert.equal(/jobs_customer/i.test(body), false);
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

async function listContains(
  app: Awaited<ReturnType<typeof buildApp>>,
  access: string,
  state: "active" | "archived" | "all",
  customerId: string,
) {
  const response = await app.inject({
    method: "GET",
    url: `/v1/customers?state=${state}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  return (response.json() as { data: { items: { id: string }[] } }).data.items.some(
    (item) => item.id === customerId,
  );
}

test("CUST-API-06 live US: delete unreferenced, block referenced, cross-tenant 404, idempotency", {
  skip: databaseUrl === undefined,
}, async () => {
  assert.ok(databaseUrl, "DATABASE_URL_API required for live evidence");

  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const store = createPostgresAuthStore(databaseUrl);
  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  const app = await buildApp({
    jwtVerifier: createStaticKeyVerifier({
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
    store,
  });

  const authA = "cust-api-06-live-auth-a";
  const authB = "cust-api-06-live-auth-b";

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

    const accessA = await token(authA, "del-a@example.test");
    const accessB = await token(authB, "del-b@example.test");

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
    const ownerA = (meA.json() as {
      data: { user: { id: string }; workspace: { id: string } };
    }).data;

    const meB = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${accessB}` },
    });
    const ownerB = (meB.json() as {
      data: { user: { id: string }; workspace: { id: string } };
    }).data;

    const createPlain = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Live Delete Target", email: "live-del@example.test" },
    });
    assert.equal(createPlain.statusCode, 201);
    const plain = (createPlain.json() as { data: { id: string } }).data;

    const createArchived = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Live Archived Delete" },
    });
    assert.equal(createArchived.statusCode, 201);
    const archived = (createArchived.json() as { data: { id: string } }).data;

    const createReferenced = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(5) },
      payload: { name: "Live Referenced" },
    });
    assert.equal(createReferenced.statusCode, 201);
    const referenced = (createReferenced.json() as { data: { id: string } }).data;

    const createB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(6) },
      payload: { name: "Tenant B Cust" },
    });
    assert.equal(createB.statusCode, 201);
    const customerB = (createB.json() as { data: { id: string } }).data;

    await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authA}, true)`;
      await tx`select set_config('app.workspace_id', ${ownerA.workspace.id}, true)`;
      await tx`
        insert into app.jobs (id, workspace_id, customer_id, title, created_by, updated_at)
        values (
          ${uuidFromSeed(10)}::uuid, ${ownerA.workspace.id}::uuid, ${referenced.id}::uuid,
          'Live Keep Job', ${ownerA.user.id}::uuid, now()
        )
      `;
    });

    await sql.begin(async (tx) => {
      await tx`select set_config('app.auth_user_id', ${authB}, true)`;
      await tx`select set_config('app.workspace_id', ${ownerB.workspace.id}, true)`;
      await tx`
        insert into app.jobs (id, workspace_id, customer_id, title, created_by, updated_at)
        values (
          ${uuidFromSeed(11)}::uuid, ${ownerB.workspace.id}::uuid, ${customerB.id}::uuid,
          'Foreign Job', ${ownerB.user.id}::uuid, now()
        )
      `;
    });

    const archiveTarget = await app.inject({
      method: "POST",
      url: `/v1/customers/${archived.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(7),
      },
      payload: { archived: true },
    });
    assert.equal(archiveTarget.statusCode, 200);
    assert.ok(
      (archiveTarget.json() as { data: { archived_at: string | null } }).data.archived_at,
    );

    const deletePlain = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${plain.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
      },
    });
    assert.equal(deletePlain.statusCode, 200, deletePlain.body);
    assert.equal((deletePlain.json() as { data: { deleted: boolean } }).data.deleted, true);

    const detailGone = await app.inject({
      method: "GET",
      url: `/v1/customers/${plain.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(detailGone.statusCode, 404);
    assert.equal(await listContains(app, accessA, "active", plain.id), false);
    assert.equal(await listContains(app, accessA, "archived", plain.id), false);
    assert.equal(await listContains(app, accessA, "all", plain.id), false);

    const deletePlainReplay = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${plain.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
      },
    });
    assert.equal(deletePlainReplay.statusCode, 200);
    assert.equal((deletePlainReplay.json() as { data: { deleted: boolean } }).data.deleted, true);
    assert.equal(
      (deletePlainReplay.json() as { meta: { request_id: string } }).meta.request_id,
      (deletePlain.json() as { meta: { request_id: string } }).meta.request_id,
    );

    const deleteArchived = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${archived.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(9),
      },
    });
    assert.equal(deleteArchived.statusCode, 200);
    assert.equal((deleteArchived.json() as { data: { deleted: boolean } }).data.deleted, true);
    assert.equal(await listContains(app, accessA, "archived", archived.id), false);

    const deleteReferenced = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${referenced.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(12),
      },
    });
    assert.equal(deleteReferenced.statusCode, 409, deleteReferenced.body);
    assert.equal(
      (deleteReferenced.json() as { error: { code: string } }).error.code,
      "CUSTOMER_REFERENCED",
    );
    assert.match(
      (deleteReferenced.json() as { error: { message: string } }).error.message,
      /Archive/i,
    );
    assertSafeErrorBody(deleteReferenced.body);

    const referencedStill = await app.inject({
      method: "GET",
      url: `/v1/customers/${referenced.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(referencedStill.statusCode, 200);

    const jobs = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${referenced.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(jobs.statusCode, 200);
    assert.equal((jobs.json() as { data: { items: { title: string }[] } }).data.items.length, 1);
    assert.equal(
      (jobs.json() as { data: { items: { title: string }[] } }).data.items[0]?.title,
      "Live Keep Job",
    );

    const referencedReplay = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${referenced.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(12),
      },
    });
    assert.equal(referencedReplay.statusCode, 409);
    assert.equal(
      (referencedReplay.json() as { error: { code: string } }).error.code,
      "CUSTOMER_REFERENCED",
    );

    const mismatch = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${referenced.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
      },
    });
    assert.equal(mismatch.statusCode, 409);
    assert.equal(
      (mismatch.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_MISMATCH",
    );

    const unknownId = uuidFromSeed(99);
    const unknownDelete = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${unknownId}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(13),
      },
    });
    const crossDelete = await app.inject({
      method: "DELETE",
      url: `/v1/customers/${customerB.id}`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(14),
      },
    });
    assert.equal(unknownDelete.statusCode, 404);
    assert.equal(crossDelete.statusCode, 404);
    assert.deepEqual(
      (unknownDelete.json() as { error: { code: string; message: string } }).error,
      (crossDelete.json() as { error: { code: string; message: string } }).error,
    );
    assert.notEqual(
      (crossDelete.json() as { error: { code: string } }).error.code,
      "CUSTOMER_REFERENCED",
    );
    assertSafeErrorBody(crossDelete.body);

    const stillB = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerB.id}`,
      headers: { authorization: `Bearer ${accessB}` },
    });
    assert.equal(stillB.statusCode, 200);
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
