import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

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

async function createTestApp() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const harness = createMemoryAuthStore();
  const app = await buildApp({
    jwtVerifier: createStaticKeyVerifier({
      key: publicKey,
      issuer: ISSUER,
      audience: AUDIENCE,
    }),
    store: harness.store,
  });
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
  return { app, token, harness };
}

function workspaceBody() {
  return {
    business_name: "Archive Repair Co",
    legal_name: "Archive Repair Co LLC",
    contact_name: "Alex Rivera",
    contact_email: "alex@example.com",
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

function key(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `eeeeeeee-eeee-4eee-8eee-${hex}`;
}

type CustomerData = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: unknown;
  archived_at: string | null;
  version: number;
};

async function readyOwner(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  token: Awaited<ReturnType<typeof createTestApp>>["token"],
  authSubject: string,
  email: string,
  workspaceKey: string,
) {
  const access = await token(authSubject, email);
  const workspace = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": workspaceKey,
    },
    payload: workspaceBody(),
  });
  assert.equal(workspace.statusCode, 200);
  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${access}` },
  });
  const body = me.json() as {
    data: { user: { id: string }; workspace: { id: string } };
  };
  return {
    access,
    workspaceId: body.data.workspace.id,
    userId: body.data.user.id,
  };
}

async function createCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<CustomerData> {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
    },
    payload,
  });
  assert.equal(response.statusCode, 201, response.body);
  return (response.json() as { data: CustomerData }).data;
}

async function archiveCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  customerId: string,
  archived: boolean,
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: `/v1/customers/${customerId}/archive`,
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
    },
    payload: { archived },
  });
}

async function listIds(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  state: "active" | "archived" | "all",
): Promise<string[]> {
  const response = await app.inject({
    method: "GET",
    url: `/v1/customers?state=${state}&limit=100`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  const items = (response.json() as { data: { items: { id: string }[] } }).data.items;
  return items.map((item) => item.id);
}

test("unauthenticated archive → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "POST",
    url: `/v1/customers/${key(1)}/archive`,
    headers: { "idempotency-key": key(2) },
    payload: { archived: true },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("unauthenticated restore → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "POST",
    url: `/v1/customers/${key(3)}/archive`,
    headers: { "idempotency-key": key(4) },
    payload: { archived: false },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("archive then restore: list filters, detail, version, idempotent no-ops", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-arch-main", "arch@example.com", key(10));
  const customer = await createCustomer(
    app,
    owner.access,
    { name: "Archive Target", email: "target@example.com" },
    key(11),
  );
  assert.equal(customer.version, 1);
  assert.equal(customer.archived_at, null);

  const archived = await archiveCustomer(app, owner.access, customer.id, true, key(12));
  assert.equal(archived.statusCode, 200, archived.body);
  const archivedData = (archived.json() as { data: CustomerData }).data;
  assert.ok(archivedData.archived_at);
  assert.equal(archivedData.version, 2);
  assert.equal(archivedData.name, "Archive Target");
  assert.equal(archivedData.email, "target@example.com");
  for (const keyName of Object.keys(archivedData)) {
    assert.ok(PUBLIC_CUSTOMER_KEYS.has(keyName), `leaked ${keyName}`);
  }

  assert.equal((await listIds(app, owner.access, "active")).includes(customer.id), false);
  assert.equal((await listIds(app, owner.access, "archived")).includes(customer.id), true);
  assert.equal((await listIds(app, owner.access, "all")).includes(customer.id), true);

  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.ok((detail.json() as { data: CustomerData }).data.archived_at);

  const alreadyArchived = await archiveCustomer(app, owner.access, customer.id, true, key(13));
  assert.equal(alreadyArchived.statusCode, 200);
  const noopArchived = (alreadyArchived.json() as { data: CustomerData }).data;
  assert.equal(noopArchived.version, 2);
  assert.equal(noopArchived.archived_at, archivedData.archived_at);

  const restored = await archiveCustomer(app, owner.access, customer.id, false, key(14));
  assert.equal(restored.statusCode, 200);
  const restoredData = (restored.json() as { data: CustomerData }).data;
  assert.equal(restoredData.archived_at, null);
  assert.equal(restoredData.version, 3);
  assert.equal(restoredData.name, "Archive Target");
  assert.equal(restoredData.email, "target@example.com");

  assert.equal((await listIds(app, owner.access, "active")).includes(customer.id), true);
  assert.equal((await listIds(app, owner.access, "archived")).includes(customer.id), false);
  assert.equal((await listIds(app, owner.access, "all")).includes(customer.id), true);

  const alreadyActive = await archiveCustomer(app, owner.access, customer.id, false, key(15));
  assert.equal(alreadyActive.statusCode, 200);
  const noopActive = (alreadyActive.json() as { data: CustomerData }).data;
  assert.equal(noopActive.version, 3);
  assert.equal(noopActive.archived_at, null);

  await app.close();
});

test("customer with jobs archives and restores; jobs remain readable", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-arch-jobs", "jobs@example.com", key(20));
  const customer = await createCustomer(app, owner.access, { name: "Referenced" }, key(21));
  const job = await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Keep Me",
    id: key(22),
  });

  const archived = await archiveCustomer(app, owner.access, customer.id, true, key(23));
  assert.equal(archived.statusCode, 200);
  assert.ok((archived.json() as { data: CustomerData }).data.archived_at);

  const jobs = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(jobs.statusCode, 200);
  const items = (jobs.json() as { data: { items: { id: string; title: string }[] } }).data.items;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, job.id);
  assert.equal(items[0]?.title, "Keep Me");

  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 200);

  const restored = await archiveCustomer(app, owner.access, customer.id, false, key(24));
  assert.equal(restored.statusCode, 200);
  assert.equal((restored.json() as { data: CustomerData }).data.archived_at, null);

  const jobsAfter = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(jobsAfter.statusCode, 200);
  assert.equal(
    (jobsAfter.json() as { data: { items: { id: string }[] } }).data.items[0]?.id,
    job.id,
  );

  await app.close();
});

test("unknown and cross-workspace archive/restore → identical generic 404", async () => {
  const { app, token } = await createTestApp();
  const ownerA = await readyOwner(app, token, "auth-arch-a", "a@example.com", key(30));
  const ownerB = await readyOwner(app, token, "auth-arch-b", "b@example.com", key(31));
  const foreign = await createCustomer(app, ownerB.access, { name: "Tenant B" }, key(32));
  const unknownId = key(33);

  const unknownArchive = await archiveCustomer(app, ownerA.access, unknownId, true, key(34));
  const crossArchive = await archiveCustomer(app, ownerA.access, foreign.id, true, key(35));
  assert.equal(unknownArchive.statusCode, 404);
  assert.equal(crossArchive.statusCode, 404);
  assert.equal(
    (unknownArchive.json() as { error: { code: string } }).error.code,
    (crossArchive.json() as { error: { code: string } }).error.code,
  );
  assert.equal((unknownArchive.json() as { error: { code: string } }).error.code, "NOT_FOUND");
  assert.deepEqual(
    Object.keys((unknownArchive.json() as { error: Record<string, unknown> }).error).sort(),
    Object.keys((crossArchive.json() as { error: Record<string, unknown> }).error).sort(),
  );

  const unknownRestore = await archiveCustomer(app, ownerA.access, unknownId, false, key(36));
  const crossRestore = await archiveCustomer(app, ownerA.access, foreign.id, false, key(37));
  assert.equal(unknownRestore.statusCode, 404);
  assert.equal(crossRestore.statusCode, 404);
  assert.equal(
    (unknownRestore.json() as { error: { code: string } }).error.code,
    (crossRestore.json() as { error: { code: string } }).error.code,
  );

  const stillB = await app.inject({
    method: "GET",
    url: `/v1/customers/${foreign.id}`,
    headers: { authorization: `Bearer ${ownerB.access}` },
  });
  assert.equal(stillB.statusCode, 200);
  assert.equal((stillB.json() as { data: CustomerData }).data.archived_at, null);
  assert.equal((stillB.json() as { data: CustomerData }).data.version, 1);

  await app.close();
});

test("archive/restore idempotent replay and mismatch", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-arch-idem", "idem@example.com", key(40));
  const customer = await createCustomer(app, owner.access, { name: "Idem Target" }, key(41));

  const first = await archiveCustomer(app, owner.access, customer.id, true, key(42));
  assert.equal(first.statusCode, 200);
  const firstBody = first.body;
  const firstData = (first.json() as { data: CustomerData }).data;
  assert.equal(firstData.version, 2);

  const replay = await archiveCustomer(app, owner.access, customer.id, true, key(42));
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body, firstBody);
  const afterReplay = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal((afterReplay.json() as { data: CustomerData }).data.version, 2);
  assert.equal(
    (afterReplay.json() as { data: CustomerData }).data.archived_at,
    firstData.archived_at,
  );

  const mismatch = await archiveCustomer(app, owner.access, customer.id, false, key(42));
  assert.equal(mismatch.statusCode, 409);
  assert.equal(
    (mismatch.json() as { error: { code: string } }).error.code,
    "IDEMPOTENCY_MISMATCH",
  );

  const restoreFirst = await archiveCustomer(app, owner.access, customer.id, false, key(43));
  assert.equal(restoreFirst.statusCode, 200);
  const restoreBody = restoreFirst.body;
  assert.equal((restoreFirst.json() as { data: CustomerData }).data.version, 3);

  const restoreReplay = await archiveCustomer(app, owner.access, customer.id, false, key(43));
  assert.equal(restoreReplay.statusCode, 200);
  assert.equal(restoreReplay.body, restoreBody);
  const afterRestoreReplay = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal((afterRestoreReplay.json() as { data: CustomerData }).data.version, 3);
  assert.equal((afterRestoreReplay.json() as { data: CustomerData }).data.archived_at, null);

  const restoreMismatch = await archiveCustomer(app, owner.access, customer.id, true, key(43));
  assert.equal(restoreMismatch.statusCode, 409);
  assert.equal(
    (restoreMismatch.json() as { error: { code: string } }).error.code,
    "IDEMPOTENCY_MISMATCH",
  );

  await app.close();
});

test("missing Idempotency-Key and invalid body → 422; If-Match not required", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-arch-val", "val@example.com", key(50));
  const customer = await createCustomer(app, owner.access, { name: "Val Target" }, key(51));

  const missingKey = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: { authorization: `Bearer ${owner.access}` },
    payload: { archived: true },
  });
  assert.equal(missingKey.statusCode, 422);

  const invalid = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(53),
    },
    payload: { archived: "yes" },
  });
  assert.equal(invalid.statusCode, 422);

  const withIfMatch = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(54),
      "if-match": "999",
    },
    payload: { archived: true },
  });
  assert.equal(withIfMatch.statusCode, 200);
  assert.equal((withIfMatch.json() as { data: CustomerData }).data.version, 2);

  await app.close();
});
