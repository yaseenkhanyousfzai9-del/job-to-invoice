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

const ISSUER = "http://auth.test/cust-api-05/v1";
const AUDIENCE = "authenticated";

const PUBLIC_CUSTOMER_KEYS = new Set([
  "id",
  "name",
  "email",
  "phone",
  "billing_address",
  "archived_at",
  "version",
  "created_at",
  "updated_at",
]);

function workspaceBody(suffix: string) {
  return {
    business_name: `Cust API05 Live ${suffix}`,
    legal_name: `Cust API05 Live ${suffix} LLC`,
    contact_name: "Live Owner",
    contact_email: `live-api05-${suffix}@example.test`,
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
  return `ffffffff-ffff-4fff-8fff-${hex}`;
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

test("live POST /v1/customers/{id}/archive archive/restore, jobs, lists, idempotency, cross-tenant", {
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

  const authA = "cust-api-05-live-auth-a";
  const authB = "cust-api-05-live-auth-b";

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

    const accessA = await token(authA, "arch-a@example.test");
    const accessB = await token(authB, "arch-b@example.test");

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

    const createPlain = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(3) },
      payload: { name: "Live Archive Target", email: "live-arch@example.test" },
    });
    assert.equal(createPlain.statusCode, 201);
    const plain = (createPlain.json() as {
      data: { id: string; version: number; archived_at: string | null };
    }).data;
    assert.equal(plain.version, 1);
    assert.equal(plain.archived_at, null);

    const createWithJob = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessA}`, "idempotency-key": uuidFromSeed(4) },
      payload: { name: "Live Referenced" },
    });
    assert.equal(createWithJob.statusCode, 201);
    const referenced = (createWithJob.json() as { data: { id: string } }).data;

    const createB = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { authorization: `Bearer ${accessB}`, "idempotency-key": uuidFromSeed(5) },
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

    const archivePlain = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(6),
      },
      payload: { archived: true },
    });
    assert.equal(archivePlain.statusCode, 200, archivePlain.body);
    const archivedPlain = (archivePlain.json() as {
      data: Record<string, unknown> & { archived_at: string | null; version: number; name: string };
    }).data;
    assert.ok(archivedPlain.archived_at);
    assert.equal(archivedPlain.version, 2);
    assert.equal(archivedPlain.name, "Live Archive Target");
    for (const keyName of Object.keys(archivedPlain)) {
      assert.ok(PUBLIC_CUSTOMER_KEYS.has(keyName), `leaked ${keyName}`);
    }

    const activeList = await app.inject({
      method: "GET",
      url: "/v1/customers?state=active&limit=100",
      headers: { authorization: `Bearer ${accessA}` },
    });
    const archivedList = await app.inject({
      method: "GET",
      url: "/v1/customers?state=archived&limit=100",
      headers: { authorization: `Bearer ${accessA}` },
    });
    const allList = await app.inject({
      method: "GET",
      url: "/v1/customers?state=all&limit=100",
      headers: { authorization: `Bearer ${accessA}` },
    });
    const activeIds = (activeList.json() as { data: { items: { id: string }[] } }).data.items.map(
      (i) => i.id,
    );
    const archivedIds = (
      archivedList.json() as { data: { items: { id: string }[] } }
    ).data.items.map((i) => i.id);
    const allIds = (allList.json() as { data: { items: { id: string }[] } }).data.items.map(
      (i) => i.id,
    );
    assert.equal(activeIds.includes(plain.id), false);
    assert.equal(archivedIds.includes(plain.id), true);
    assert.equal(allIds.includes(plain.id), true);

    const detailArchived = await app.inject({
      method: "GET",
      url: `/v1/customers/${plain.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(detailArchived.statusCode, 200);
    assert.ok((detailArchived.json() as { data: { archived_at: string | null } }).data.archived_at);

    const alreadyArchived = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(7),
      },
      payload: { archived: true },
    });
    assert.equal(alreadyArchived.statusCode, 200);
    assert.equal(
      (alreadyArchived.json() as { data: { version: number } }).data.version,
      2,
    );

    const archiveReplay = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(6),
      },
      payload: { archived: true },
    });
    assert.equal(archiveReplay.statusCode, 200);
    const replayArchived = (archiveReplay.json() as {
      data: { id: string; version: number; archived_at: string | null };
      meta: { request_id: string };
    });
    assert.equal(replayArchived.data.id, archivedPlain.id);
    assert.equal(replayArchived.data.version, 2);
    assert.equal(replayArchived.data.archived_at, archivedPlain.archived_at);
    assert.equal(
      replayArchived.meta.request_id,
      (archivePlain.json() as { meta: { request_id: string } }).meta.request_id,
    );
    assert.equal(
      (await app.inject({
        method: "GET",
        url: `/v1/customers/${plain.id}`,
        headers: { authorization: `Bearer ${accessA}` },
      }).then((r) => (r.json() as { data: { version: number } }).data.version)),
      2,
    );

    const restorePlain = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
      },
      payload: { archived: false },
    });
    assert.equal(restorePlain.statusCode, 200);
    const restoredPlain = (restorePlain.json() as {
      data: { id: string; archived_at: string | null; version: number };
    }).data;
    assert.equal(restoredPlain.archived_at, null);
    assert.equal(restoredPlain.version, 3);

    const activeAfter = await app.inject({
      method: "GET",
      url: "/v1/customers?state=active&limit=100",
      headers: { authorization: `Bearer ${accessA}` },
    });
    const archivedAfter = await app.inject({
      method: "GET",
      url: "/v1/customers?state=archived&limit=100",
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(
      (activeAfter.json() as { data: { items: { id: string }[] } }).data.items
        .map((i) => i.id)
        .includes(plain.id),
      true,
    );
    assert.equal(
      (archivedAfter.json() as { data: { items: { id: string }[] } }).data.items
        .map((i) => i.id)
        .includes(plain.id),
      false,
    );

    const alreadyActive = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(9),
      },
      payload: { archived: false },
    });
    assert.equal(alreadyActive.statusCode, 200);
    assert.equal((alreadyActive.json() as { data: { version: number } }).data.version, 3);

    const restoreReplay = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
      },
      payload: { archived: false },
    });
    assert.equal(restoreReplay.statusCode, 200);
    const replayRestored = (restoreReplay.json() as {
      data: { id: string; version: number; archived_at: string | null };
      meta: { request_id: string };
    });
    assert.equal(replayRestored.data.id, restoredPlain.id);
    assert.equal(replayRestored.data.version, 3);
    assert.equal(replayRestored.data.archived_at, null);
    assert.equal(
      replayRestored.meta.request_id,
      (restorePlain.json() as { meta: { request_id: string } }).meta.request_id,
    );

    const mismatch = await app.inject({
      method: "POST",
      url: `/v1/customers/${plain.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(8),
      },
      payload: { archived: true },
    });
    assert.equal(mismatch.statusCode, 409);
    assert.equal(
      (mismatch.json() as { error: { code: string } }).error.code,
      "IDEMPOTENCY_MISMATCH",
    );

    const archiveReferenced = await app.inject({
      method: "POST",
      url: `/v1/customers/${referenced.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(11),
      },
      payload: { archived: true },
    });
    assert.equal(archiveReferenced.statusCode, 200);
    assert.ok(
      (archiveReferenced.json() as { data: { archived_at: string | null } }).data.archived_at,
    );

    const jobs = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${referenced.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(jobs.statusCode, 200);
    const jobItems = (jobs.json() as { data: { items: { id: string; title: string }[] } }).data
      .items;
    assert.equal(jobItems.length, 1);
    assert.equal(jobItems[0]?.title, "Live Keep Job");

    const restoreReferenced = await app.inject({
      method: "POST",
      url: `/v1/customers/${referenced.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(12),
      },
      payload: { archived: false },
    });
    assert.equal(restoreReferenced.statusCode, 200);
    assert.equal(
      (restoreReferenced.json() as { data: { archived_at: string | null } }).data.archived_at,
      null,
    );
    const jobsAfter = await app.inject({
      method: "GET",
      url: `/v1/jobs?customer_id=${referenced.id}`,
      headers: { authorization: `Bearer ${accessA}` },
    });
    assert.equal(jobsAfter.statusCode, 200);
    assert.equal(
      (jobsAfter.json() as { data: { items: { title: string }[] } }).data.items[0]?.title,
      "Live Keep Job",
    );

    const unknownId = uuidFromSeed(99);
    const unknownArchive = await app.inject({
      method: "POST",
      url: `/v1/customers/${unknownId}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(13),
      },
      payload: { archived: true },
    });
    const crossArchive = await app.inject({
      method: "POST",
      url: `/v1/customers/${customerB.id}/archive`,
      headers: {
        authorization: `Bearer ${accessA}`,
        "idempotency-key": uuidFromSeed(14),
      },
      payload: { archived: true },
    });
    assert.equal(unknownArchive.statusCode, 404);
    assert.equal(crossArchive.statusCode, 404);
    assert.equal(
      (unknownArchive.json() as { error: { code: string } }).error.code,
      (crossArchive.json() as { error: { code: string } }).error.code,
    );

    const stillB = await app.inject({
      method: "GET",
      url: `/v1/customers/${customerB.id}`,
      headers: { authorization: `Bearer ${accessB}` },
    });
    assert.equal(stillB.statusCode, 200);
    assert.equal((stillB.json() as { data: { archived_at: string | null } }).data.archived_at, null);
    assert.equal((stillB.json() as { data: { version: number } }).data.version, 1);
  } finally {
    await cleanupOwner(sql, authA);
    await cleanupOwner(sql, authB);
    await app.close();
    await store.close?.();
    await sql.end({ timeout: 5 });
  }
});
