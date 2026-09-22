/**
 * Consumer integration contract tests for the Customer module.
 * Locks public DTO + list/CRUD/archive/delete/Job FK behaviours for handoff.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";
import {
  CUSTOMER_INTERNAL_FIELDS,
  CUSTOMER_PUBLIC_DTO_KEYS,
  assertCustomerPublicDto,
  createActiveCustomer,
  createArchivedCustomer,
  createCrossWorkspaceCustomer,
  createCustomerWithJob,
  createWorkspaceOwner,
  uuidFromSeed,
} from "./test-helpers/customerFixtures.ts";

const ISSUER = "http://auth.test/customer-contract/v1";
const AUDIENCE = "authenticated";
const P = "cccccccc-cccc-4ccc-8ccc";

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

async function readyOwner(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  token: Awaited<ReturnType<typeof createTestApp>>["token"],
  authSubject: string,
  email: string,
  workspaceKey: string,
) {
  const { accessToken } = await createWorkspaceOwner(app, token, {
    authSubject,
    email,
    idempotencyKey: workspaceKey,
  });
  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assert.equal(me.statusCode, 200);
  const data = (
    me.json() as {
      data: { user: { id: string }; workspace: { id: string } };
    }
  ).data;
  return {
    access: accessToken,
    userId: data.user.id,
    workspaceId: data.workspace.id,
    authSubject,
  };
}

test("Customer public DTO shape remains stable; internal fields not exposed", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-dto", "dto@example.test", uuidFromSeed(P, 1));
  const customer = await createActiveCustomer(app, owner.access, {
    name: "DTO Customer",
    email: "dto-cust@example.test",
    phone: "+15125550100",
    idempotencyKey: uuidFromSeed(P, 2),
  });
  assertCustomerPublicDto(customer);
  assert.deepEqual(Object.keys(customer).sort(), [...CUSTOMER_PUBLIC_DTO_KEYS].sort());
  for (const key of CUSTOMER_INTERNAL_FIELDS) {
    assert.equal(key in customer, false);
  }
});

test("active / archived / all list filters", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-list", "list@example.test", uuidFromSeed(P, 3));
  const active = await createActiveCustomer(app, owner.access, {
    name: "Active One",
    idempotencyKey: uuidFromSeed(P, 4),
  });
  const archived = await createArchivedCustomer(app, owner.access, {
    name: "Archived One",
    createKey: uuidFromSeed(P, 5),
    archiveKey: uuidFromSeed(P, 6),
  });

  const activeList = await app.inject({
    method: "GET",
    url: "/v1/customers?state=active",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(activeList.statusCode, 200);
  const activeIds = (activeList.json() as { data: { items: { id: string }[] } }).data.items.map(
    (item) => item.id,
  );
  assert.ok(activeIds.includes(active.id));
  assert.equal(activeIds.includes(archived.id), false);

  const archivedList = await app.inject({
    method: "GET",
    url: "/v1/customers?state=archived",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  const archivedIds = (
    archivedList.json() as { data: { items: { id: string }[] } }
  ).data.items.map((item) => item.id);
  assert.ok(archivedIds.includes(archived.id));
  assert.equal(archivedIds.includes(active.id), false);

  const allList = await app.inject({
    method: "GET",
    url: "/v1/customers?state=all",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  const allIds = (allList.json() as { data: { items: { id: string }[] } }).data.items.map(
    (item) => item.id,
  );
  assert.ok(allIds.includes(active.id));
  assert.ok(allIds.includes(archived.id));
});

test("active Customer Job FK works; archived remains readable; referenced delete blocked", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-fk", "fk@example.test", uuidFromSeed(P, 7));
  const { customer, job } = await createCustomerWithJob(app, owner.access, harness, {
    workspaceId: owner.workspaceId,
    createdBy: owner.userId,
    customerName: "With Job",
    jobTitle: "Bound Job",
    customerKey: uuidFromSeed(P, 8),
    jobId: uuidFromSeed(P, 9),
  });
  assert.equal(job.customer_id, customer.id);

  const archived = await createArchivedCustomer(app, owner.access, {
    name: "Readable Archived",
    createKey: uuidFromSeed(P, 10),
    archiveKey: uuidFromSeed(P, 11),
  });
  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${archived.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.ok((detail.json() as { data: { archived_at: string | null } }).data.archived_at);

  const blocked = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 12),
    },
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(
    (blocked.json() as { error: { code: string } }).error.code,
    "CUSTOMER_REFERENCED",
  );
});

test("unreferenced Customer can be deleted", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-del", "del@example.test", uuidFromSeed(P, 13));
  const customer = await createActiveCustomer(app, owner.access, {
    name: "Lonely",
    idempotencyKey: uuidFromSeed(P, 14),
  });
  const deleted = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 15),
    },
  });
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual((deleted.json() as { data: unknown }).data, { deleted: true });
});

test("cross-workspace Customer access is generic 404; Job binding fails", async () => {
  const { app, token, harness } = await createTestApp();
  const ownerA = await readyOwner(app, token, "auth-a", "a@example.test", uuidFromSeed(P, 16));
  const foreign = await createCrossWorkspaceCustomer(app, token, {
    authSubject: "auth-b",
    email: "b@example.test",
    workspaceKey: uuidFromSeed(P, 17),
    customerKey: uuidFromSeed(P, 18),
    customerName: "Foreign Cust",
  });

  const getForeign = await app.inject({
    method: "GET",
    url: `/v1/customers/${foreign.customer.id}`,
    headers: { authorization: `Bearer ${ownerA.access}` },
  });
  assert.equal(getForeign.statusCode, 404);

  await assert.rejects(
    () =>
      harness.createJob({
        workspaceId: ownerA.workspaceId,
        customerId: foreign.customer.id,
        createdBy: ownerA.userId,
        title: "Cross bind",
        id: uuidFromSeed(P, 19),
      }),
    /customer missing/,
  );
});

test("duplicate email warning and confirmed duplicate; self-edit no conflict", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-dup", "dup@example.test", uuidFromSeed(P, 20));
  const first = await createActiveCustomer(app, owner.access, {
    name: "First",
    email: "same@example.test",
    idempotencyKey: uuidFromSeed(P, 21),
  });

  const selfSame = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${first.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 24),
      "if-match": String(first.version),
    },
    payload: { email: "same@example.test", name: "First Renamed" },
  });
  assert.equal(selfSame.statusCode, 200);

  const warn = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 22),
    },
    payload: {
      name: "Second",
      email: "same@example.test",
      phone: null,
      billing_address: null,
      confirm_duplicate_email: false,
    },
  });
  assert.equal(warn.statusCode, 409);
  assert.equal(
    (warn.json() as { error: { code: string } }).error.code,
    "DUPLICATE_CUSTOMER_EMAIL",
  );

  const confirmed = await createActiveCustomer(app, owner.access, {
    name: "Second",
    email: "same@example.test",
    confirmDuplicateEmail: true,
    idempotencyKey: uuidFromSeed(P, 23),
  });
  assert.notEqual(confirmed.id, first.id);
});

test("PATCH version conflict remains protected", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-ver", "ver@example.test", uuidFromSeed(P, 25));
  const customer = await createActiveCustomer(app, owner.access, {
    name: "Versioned",
    idempotencyKey: uuidFromSeed(P, 26),
  });
  const stale = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 27),
      "if-match": "999",
    },
    payload: { name: "Nope" },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal((stale.json() as { error: { code: string } }).error.code, "VERSION_CONFLICT");
});

test("archive/restore preserve Job relationship; edit does not mutate Job.customer_id", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-ar", "ar@example.test", uuidFromSeed(P, 28));
  const { customer, job } = await createCustomerWithJob(app, owner.access, harness, {
    workspaceId: owner.workspaceId,
    createdBy: owner.userId,
    customerName: "Keep Link",
    jobTitle: "Linked Job",
    customerKey: uuidFromSeed(P, 29),
    jobId: uuidFromSeed(P, 30),
  });

  const archived = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 31),
    },
    payload: { archived: true },
  });
  assert.equal(archived.statusCode, 200);

  const jobsAfterArchive = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(jobsAfterArchive.statusCode, 200);
  const itemsAfterArchive = (
    jobsAfterArchive.json() as { data: { items: { id: string; customer_id: string }[] } }
  ).data.items;
  assert.equal(itemsAfterArchive.length, 1);
  assert.equal(itemsAfterArchive[0]?.customer_id, customer.id);

  const restored = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 32),
    },
    payload: { archived: false },
  });
  assert.equal(restored.statusCode, 200);

  const jobsAfterRestore = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(
    (jobsAfterRestore.json() as { data: { items: { customer_id: string }[] } }).data.items[0]
      ?.customer_id,
    customer.id,
  );

  const patched = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 33),
      "if-match": String(
        (restored.json() as { data: { version: number } }).data.version,
      ),
    },
    payload: { name: "Renamed Keep Link", email: "renamed@example.test" },
  });
  assert.equal(patched.statusCode, 200);

  const jobsAfterEdit = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(
    (jobsAfterEdit.json() as { data: { items: { id: string; customer_id: string }[] } }).data
      .items[0]?.customer_id,
    customer.id,
  );
  assert.equal(
    (jobsAfterEdit.json() as { data: { items: { id: string }[] } }).data.items[0]?.id,
    job.id,
  );
});
