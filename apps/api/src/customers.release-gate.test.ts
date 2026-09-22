/**
 * Customer Module Release Gate — memory Fastify lifecycle.
 * Deterministic regression suite for post-integration verification.
 * Product behavior is locked by docs/CUSTOMER_MODULE_CONTRACT.md.
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
  createCrossWorkspaceCustomer,
  createWorkspaceOwner,
  uuidFromSeed,
} from "./test-helpers/customerFixtures.ts";

const ISSUER = "http://auth.test/customer-release-gate/v1";
const AUDIENCE = "authenticated";
const P = "dddddddd-dddd-4ddd-8ddd";

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
  };
}

function listIds(
  body: unknown,
): string[] {
  return (body as { data: { items: { id: string }[] } }).data.items.map((item) => item.id);
}

test("Customer release gate: CRUD lifecycle, archive, delete, DTO, cross-tenant, Job FK", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(
    app,
    token,
    "rg-owner",
    "rg-owner@example.test",
    uuidFromSeed(P, 1),
  );

  // 1 + 17 — create active Customer; public DTO has no internal fields
  const customer = await createActiveCustomer(app, owner.access, {
    name: "Release Gate Primary",
    email: "rg-primary@example.test",
    phone: "+15125550199",
    idempotencyKey: uuidFromSeed(P, 2),
  });
  assertCustomerPublicDto(customer);
  assert.equal(customer.archived_at, null);
  assert.deepEqual(Object.keys(customer).sort(), [...CUSTOMER_PUBLIC_DTO_KEYS].sort());
  for (const key of CUSTOMER_INTERNAL_FIELDS) {
    assert.equal(key in customer, false);
  }

  // 2 — detail readable
  const detail = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal((detail.json() as { data: { id: string } }).data.id, customer.id);

  // 3 — appears in Active list
  const activeList = await app.inject({
    method: "GET",
    url: "/v1/customers?state=active",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(activeList.statusCode, 200);
  assert.ok(listIds(activeList.json()).includes(customer.id));

  // 4 — duplicate normalized email warns
  const dupWarn = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 3),
    },
    payload: {
      name: "Release Gate Duplicate",
      email: "RG-Primary@example.test",
      phone: null,
      billing_address: null,
      confirm_duplicate_email: false,
    },
  });
  assert.equal(dupWarn.statusCode, 409);
  assert.equal(
    (dupWarn.json() as { error: { code: string } }).error.code,
    "DUPLICATE_CUSTOMER_EMAIL",
  );

  // 5 — confirmed duplicate succeeds
  const duplicate = await createActiveCustomer(app, owner.access, {
    name: "Release Gate Duplicate",
    email: "rg-primary@example.test",
    confirmDuplicateEmail: true,
    idempotencyKey: uuidFromSeed(P, 4),
  });
  assert.notEqual(duplicate.id, customer.id);

  // 6 — edit with If-Match increments version
  const patched = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 5),
      "if-match": String(customer.version),
    },
    payload: { name: "Release Gate Primary Edited" },
  });
  assert.equal(patched.statusCode, 200);
  const patchedBody = (patched.json() as { data: { version: number; name: string } }).data;
  assert.equal(patchedBody.version, customer.version + 1);
  assert.equal(patchedBody.name, "Release Gate Primary Edited");

  // 7 — stale If-Match → VERSION_CONFLICT; no overwrite
  const stale = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 6),
      "if-match": String(customer.version),
    },
    payload: { name: "Should Not Stick" },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal((stale.json() as { error: { code: string } }).error.code, "VERSION_CONFLICT");
  const afterStale = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(
    (afterStale.json() as { data: { name: string } }).data.name,
    "Release Gate Primary Edited",
  );

  // 8 — archive: out of Active, in Archived, detail readable
  const archived = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 7),
    },
    payload: { archived: true },
  });
  assert.equal(archived.statusCode, 200);
  assert.ok((archived.json() as { data: { archived_at: string | null } }).data.archived_at);

  const activeAfterArchive = await app.inject({
    method: "GET",
    url: "/v1/customers?state=active",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(listIds(activeAfterArchive.json()).includes(customer.id), false);

  const archivedList = await app.inject({
    method: "GET",
    url: "/v1/customers?state=archived",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.ok(listIds(archivedList.json()).includes(customer.id));

  const detailArchived = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(detailArchived.statusCode, 200);

  // 9 — restore: back to Active, out of Archived
  const restored = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 8),
    },
    payload: { archived: false },
  });
  assert.equal(restored.statusCode, 200);
  assert.equal(
    (restored.json() as { data: { archived_at: string | null } }).data.archived_at,
    null,
  );

  const activeAfterRestore = await app.inject({
    method: "GET",
    url: "/v1/customers?state=active",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.ok(listIds(activeAfterRestore.json()).includes(customer.id));

  const archivedAfterRestore = await app.inject({
    method: "GET",
    url: "/v1/customers?state=archived",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(listIds(archivedAfterRestore.json()).includes(customer.id), false);

  // 10 — Customer with Job relationship remains valid
  const job = await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer.id,
    createdBy: owner.userId,
    title: "Release Gate Job",
    id: uuidFromSeed(P, 9),
  });
  assert.equal(job.customer_id, customer.id);
  const jobsForCustomer = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(jobsForCustomer.statusCode, 200);
  assert.equal(
    (jobsForCustomer.json() as { data: { items: { id: string }[] } }).data.items[0]?.id,
    job.id,
  );

  // 11 — referenced delete blocked; Customer + Job remain
  const blocked = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 10),
    },
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal(
    (blocked.json() as { error: { code: string } }).error.code,
    "CUSTOMER_REFERENCED",
  );
  const stillThere = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(stillThere.statusCode, 200);
  const jobsStill = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(
    (jobsStill.json() as { data: { items: { id: string }[] } }).data.items.length,
    1,
  );

  // 12 — unreferenced Customer delete succeeds
  const deletedDup = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${duplicate.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 11),
    },
  });
  assert.equal(deletedDup.statusCode, 200);
  assert.deepEqual((deletedDup.json() as { data: unknown }).data, { deleted: true });

  // 13 — deleted Customer → generic 404
  const gone = await app.inject({
    method: "GET",
    url: `/v1/customers/${duplicate.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(gone.statusCode, 404);

  // 14 + 15 — cross-workspace read + mutation → generic 404
  const foreign = await createCrossWorkspaceCustomer(app, token, {
    authSubject: "rg-foreign",
    email: "rg-foreign@example.test",
    workspaceKey: uuidFromSeed(P, 12),
    customerKey: uuidFromSeed(P, 13),
    customerName: "Foreign Release Gate",
  });
  const crossGet = await app.inject({
    method: "GET",
    url: `/v1/customers/${foreign.customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(crossGet.statusCode, 404);

  const crossPatch = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${foreign.customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 14),
      "if-match": "1",
    },
    payload: { name: "Hijack" },
  });
  assert.equal(crossPatch.statusCode, 404);

  const crossDelete = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${foreign.customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 15),
    },
  });
  assert.equal(crossDelete.statusCode, 404);

  // 16 — cross-workspace Job.customer_id binding rejected
  await assert.rejects(
    () =>
      harness.createJob({
        workspaceId: owner.workspaceId,
        customerId: foreign.customer.id,
        createdBy: owner.userId,
        title: "Illegal Cross Bind",
        id: uuidFromSeed(P, 16),
      }),
    /customer missing/,
  );
});
