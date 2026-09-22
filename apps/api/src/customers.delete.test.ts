import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

const ISSUER = "http://auth.test/cust-api-06/v1";
const AUDIENCE = "authenticated";

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
    business_name: "Delete Repair Co",
    legal_name: "Delete Repair Co LLC",
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
  return `dddddddd-dddd-4ddd-8ddd-${hex}`;
}

type CustomerData = {
  id: string;
  name: string;
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
  assert.equal(workspace.statusCode, 200, workspace.body);
  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(me.statusCode, 200);
  const data = (me.json() as {
    data: { user: { id: string }; workspace: { id: string } };
  }).data;
  return {
    access,
    userId: data.user.id,
    workspaceId: data.workspace.id,
  };
}

async function createCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  payload: { name: string; email?: string | null },
  idempotencyKey: string,
) {
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

async function deleteCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  customerId: string,
  idempotencyKey: string,
) {
  return app.inject({
    method: "DELETE",
    url: `/v1/customers/${customerId}`,
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
    },
  });
}

async function listIds(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  state: "active" | "archived" | "all",
) {
  const response = await app.inject({
    method: "GET",
    url: `/v1/customers?state=${state}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  return (response.json() as { data: { items: { id: string }[] } }).data.items.map(
    (item) => item.id,
  );
}

function assertSafeErrorBody(body: string) {
  assert.equal(/23503/.test(body), false);
  assert.equal(/foreign key/i.test(body), false);
  assert.equal(/violates/i.test(body), false);
  assert.equal(/postgres/i.test(body), false);
  assert.equal(/jobs_customer/i.test(body), false);
}

test("unauthenticated DELETE → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${key(1)}`,
    headers: { "idempotency-key": key(2) },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("missing Idempotency-Key → 422", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-idem", "del-idem@example.com", key(3));
  const customer = await createCustomer(app, owner.access, { name: "No Key" }, key(4));
  const response = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(
    (response.json() as { error: { code: string } }).error.code,
    "VALIDATION_FAILED",
  );
  await app.close();
});

test("unreferenced active Customer deletes; absent from detail and all lists", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-plain", "del-plain@example.com", key(10));
  const customer = await createCustomer(
    app,
    owner.access,
    { name: "Delete Me", email: "delete-me@example.com" },
    key(11),
  );

  const deleted = await deleteCustomer(app, owner.access, customer.id, key(12));
  assert.equal(deleted.statusCode, 200, deleted.body);
  const body = deleted.json() as { data: { deleted: boolean } };
  assert.equal(body.data.deleted, true);

  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 404);

  assert.equal((await listIds(app, owner.access, "active")).includes(customer.id), false);
  assert.equal((await listIds(app, owner.access, "archived")).includes(customer.id), false);
  assert.equal((await listIds(app, owner.access, "all")).includes(customer.id), false);

  await app.close();
});

test("unreferenced archived Customer may be deleted", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-arch", "del-arch@example.com", key(20));
  const customer = await createCustomer(app, owner.access, { name: "Archived Gone" }, key(21));

  const archive = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(22),
    },
    payload: { archived: true },
  });
  assert.equal(archive.statusCode, 200);
  assert.ok((archive.json() as { data: CustomerData }).data.archived_at);

  const deleted = await deleteCustomer(app, owner.access, customer.id, key(23));
  assert.equal(deleted.statusCode, 200);
  assert.equal((deleted.json() as { data: { deleted: boolean } }).data.deleted, true);

  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 404);
  assert.equal((await listIds(app, owner.access, "archived")).includes(customer.id), false);
  assert.equal((await listIds(app, owner.access, "all")).includes(customer.id), false);

  await app.close();
});

test("referenced Customer with one Job → 409 CUSTOMER_REFERENCED; customer and job remain", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-ref", "del-ref@example.com", key(30));
  const customer = await createCustomer(app, owner.access, { name: "Has Job" }, key(31));
  const job = await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Keep Job",
    id: key(32),
  });

  const blocked = await deleteCustomer(app, owner.access, customer.id, key(33));
  assert.equal(blocked.statusCode, 409, blocked.body);
  const error = (blocked.json() as { error: { code: string; message: string } }).error;
  assert.equal(error.code, "CUSTOMER_REFERENCED");
  assert.match(error.message, /Archive/i);
  assertSafeErrorBody(blocked.body);

  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal((detail.json() as { data: CustomerData }).data.name, "Has Job");

  const jobs = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(jobs.statusCode, 200);
  const items = (jobs.json() as { data: { items: { id: string }[] } }).data.items;
  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, job.id);

  await app.close();
});

test("Customer with multiple Jobs → delete blocked; jobs remain", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-multi", "del-multi@example.com", key(40));
  const customer = await createCustomer(app, owner.access, { name: "Many Jobs" }, key(41));
  await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Job A",
    id: key(42),
  });
  await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Job B",
    id: key(43),
  });

  const blocked = await deleteCustomer(app, owner.access, customer.id, key(44));
  assert.equal(blocked.statusCode, 409);
  assert.equal(
    (blocked.json() as { error: { code: string } }).error.code,
    "CUSTOMER_REFERENCED",
  );
  assertSafeErrorBody(blocked.body);

  const jobs = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(jobs.statusCode, 200);
  assert.equal((jobs.json() as { data: { items: unknown[] } }).data.items.length, 2);

  await app.close();
});

test("archived-but-referenced Customer still 409", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-arch-ref", "del-arch-ref@example.com", key(50));
  const customer = await createCustomer(app, owner.access, { name: "Arch Ref" }, key(51));
  await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Still Blocks",
    id: key(52),
  });
  const archive = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(53),
    },
    payload: { archived: true },
  });
  assert.equal(archive.statusCode, 200);

  const blocked = await deleteCustomer(app, owner.access, customer.id, key(54));
  assert.equal(blocked.statusCode, 409);
  assert.equal(
    (blocked.json() as { error: { code: string } }).error.code,
    "CUSTOMER_REFERENCED",
  );

  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.ok((detail.json() as { data: CustomerData }).data.archived_at);

  await app.close();
});

test("unknown and cross-workspace DELETE → identical generic 404 (never conflict)", async () => {
  const { app, token, harness } = await createTestApp();
  const ownerA = await readyOwner(app, token, "auth-del-a", "del-a@example.com", key(60));
  const ownerB = await readyOwner(app, token, "auth-del-b", "del-b@example.com", key(61));
  const foreign = await createCustomer(app, ownerB.access, { name: "Foreign" }, key(62));
  await harness.createJob({
    workspaceId: ownerB.workspaceId,
    customerId: foreign.id,
    createdBy: ownerB.userId,
    title: "Foreign Job",
    id: key(63),
  });
  const unknownId = key(64);

  const unknown = await deleteCustomer(app, ownerA.access, unknownId, key(65));
  const cross = await deleteCustomer(app, ownerA.access, foreign.id, key(66));
  assert.equal(unknown.statusCode, 404);
  assert.equal(cross.statusCode, 404);
  assert.deepEqual(
    (unknown.json() as { error: { code: string; message: string } }).error,
    (cross.json() as { error: { code: string; message: string } }).error,
  );
  assert.notEqual(
    (cross.json() as { error: { code: string } }).error.code,
    "CUSTOMER_REFERENCED",
  );
  assertSafeErrorBody(cross.body);

  const foreignStill = await app.inject({
    method: "GET",
    url: `/v1/customers/${foreign.id}`,
    headers: { authorization: `Bearer ${ownerB.access}` },
  });
  assert.equal(foreignStill.statusCode, 200);

  await app.close();
});

test("successful delete idempotency replay and mismatch", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-replay", "del-replay@example.com", key(70));
  const customer = await createCustomer(app, owner.access, { name: "Replay Me" }, key(71));
  const other = await createCustomer(app, owner.access, { name: "Other" }, key(72));

  const first = await deleteCustomer(app, owner.access, customer.id, key(73));
  assert.equal(first.statusCode, 200);
  const firstBody = first.json() as {
    data: { deleted: boolean };
    meta: { request_id: string };
  };
  assert.equal(firstBody.data.deleted, true);

  const replay = await deleteCustomer(app, owner.access, customer.id, key(73));
  assert.equal(replay.statusCode, 200);
  const replayBody = replay.json() as {
    data: { deleted: boolean };
    meta: { request_id: string };
  };
  assert.equal(replayBody.data.deleted, true);
  assert.equal(replayBody.meta.request_id, firstBody.meta.request_id);

  const mismatch = await deleteCustomer(app, owner.access, other.id, key(73));
  assert.equal(mismatch.statusCode, 409);
  assert.equal(
    (mismatch.json() as { error: { code: string } }).error.code,
    "IDEMPOTENCY_MISMATCH",
  );

  const otherStill = await app.inject({
    method: "GET",
    url: `/v1/customers/${other.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(otherStill.statusCode, 200);

  await app.close();
});

test("referenced delete 409 is stored and replayed under Idempotency-Key", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del-ref-idem", "del-ref-idem@example.com", key(80));
  const customer = await createCustomer(app, owner.access, { name: "Blocked Replay" }, key(81));
  await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Blocks",
    id: key(82),
  });

  const first = await deleteCustomer(app, owner.access, customer.id, key(83));
  assert.equal(first.statusCode, 409);
  const firstError = (first.json() as {
    error: { code: string };
    meta?: { request_id: string };
  });
  assert.equal(firstError.error.code, "CUSTOMER_REFERENCED");

  const replay = await deleteCustomer(app, owner.access, customer.id, key(83));
  assert.equal(replay.statusCode, 409);
  assert.equal(
    (replay.json() as { error: { code: string } }).error.code,
    "CUSTOMER_REFERENCED",
  );
  if (firstError.meta?.request_id) {
    assert.equal(
      (replay.json() as { meta: { request_id: string } }).meta.request_id,
      firstError.meta.request_id,
    );
  }

  await app.close();
});
