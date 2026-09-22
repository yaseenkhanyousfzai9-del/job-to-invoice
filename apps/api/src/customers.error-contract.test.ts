/**
 * Customer API Error Contract — locks public status/code/details shapes.
 * Authority: docs/CUSTOMER_MODULE_CONTRACT.md + docs/API.md.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";
import {
  CUSTOMER_INTERNAL_FIELDS,
  assertCustomerPublicDto,
  createActiveCustomer,
  createCrossWorkspaceCustomer,
  createCustomerWithJob,
  createWorkspaceOwner,
  uuidFromSeed,
  type CustomerPublic,
} from "./test-helpers/customerFixtures.ts";

const ISSUER = "http://auth.test/customer-error-contract/v1";
const AUDIENCE = "authenticated";
const P = "eeeeeeee-eeee-4eee-8eee";

type ErrorBody = {
  error: {
    code: string;
    message: string;
    retryable?: boolean;
    details?: Record<string, unknown>;
    field_errors?: Record<string, string[]>;
  };
};

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

function assertNoInternalLeak(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const key of CUSTOMER_INTERNAL_FIELDS) {
    assert.equal(new RegExp(`"${key}"`).test(text), false, `leaked ${key}`);
  }
  assert.equal(/23503/.test(text), false);
  assert.equal(/foreign key/i.test(text), false);
  assert.equal(/violates/i.test(text), false);
}

function assertGeneric404Pair(
  unknownRes: { statusCode: number; json: () => unknown },
  crossRes: { statusCode: number; json: () => unknown },
): void {
  assert.equal(unknownRes.statusCode, 404);
  assert.equal(crossRes.statusCode, 404);
  const a = unknownRes.json() as ErrorBody;
  const b = crossRes.json() as ErrorBody;
  assert.equal(a.error.code, "NOT_FOUND");
  assert.equal(b.error.code, "NOT_FOUND");
  assert.equal(a.error.message, b.error.message);
  assert.equal(a.error.details, undefined);
  assert.equal(b.error.details, undefined);
  assertNoInternalLeak(a);
  assertNoInternalLeak(b);
}

test("Customer error contract: create 401/422/duplicate/idempotency mismatch", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "ec-create", "ec-create@example.test", uuidFromSeed(P, 1));

  const unauth = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { "idempotency-key": uuidFromSeed(P, 2) },
    payload: { name: "X", email: null, phone: null, billing_address: null },
  });
  assert.equal(unauth.statusCode, 401);
  assert.equal((unauth.json() as ErrorBody).error.code, "UNAUTHENTICATED");

  const invalid = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 3),
    },
    payload: { name: "", email: null, phone: null, billing_address: null },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal((invalid.json() as ErrorBody).error.code, "VALIDATION_FAILED");
  assertNoInternalLeak(invalid.json());

  await createActiveCustomer(app, owner.access, {
    name: "Primary",
    email: "dup@example.test",
    idempotencyKey: uuidFromSeed(P, 4),
  });
  const dup = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 5),
    },
    payload: {
      name: "Secondary",
      email: "dup@example.test",
      phone: null,
      billing_address: null,
      confirm_duplicate_email: false,
    },
  });
  assert.equal(dup.statusCode, 409);
  const dupBody = dup.json() as ErrorBody;
  assert.equal(dupBody.error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assert.equal(dupBody.error.retryable, false);
  const duplicates = (dupBody.error.details as { duplicates?: { id: string; name: string }[] })
    ?.duplicates;
  assert.ok(Array.isArray(duplicates) && duplicates.length >= 1);
  assert.equal("email" in (duplicates[0] ?? {}), false);
  assertNoInternalLeak(dupBody);

  const firstCreate = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 6),
    },
    payload: {
      name: "Idem A",
      email: null,
      phone: null,
      billing_address: null,
    },
  });
  assert.equal(firstCreate.statusCode, 201);
  const mismatch = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 6),
    },
    payload: {
      name: "Idem B Different",
      email: null,
      phone: null,
      billing_address: null,
    },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal((mismatch.json() as ErrorBody).error.code, "IDEMPOTENCY_MISMATCH");
});

test("Customer error contract: list invalid state/cursor 422", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "ec-list", "ec-list@example.test", uuidFromSeed(P, 7));

  const unauth = await app.inject({ method: "GET", url: "/v1/customers" });
  assert.equal(unauth.statusCode, 401);
  assert.equal((unauth.json() as ErrorBody).error.code, "UNAUTHENTICATED");

  const badState = await app.inject({
    method: "GET",
    url: "/v1/customers?state=nope",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(badState.statusCode, 422);
  assert.equal((badState.json() as ErrorBody).error.code, "VALIDATION_FAILED");

  const badCursor = await app.inject({
    method: "GET",
    url: "/v1/customers?cursor=not-a-cursor",
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(badCursor.statusCode, 422);
  assert.equal((badCursor.json() as ErrorBody).error.code, "VALIDATION_FAILED");
  assertNoInternalLeak(badCursor.json());
});

test("Customer error contract: detail/edit/archive/delete generic 404 privacy", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "ec-404", "ec-404@example.test", uuidFromSeed(P, 8));
  const foreign = await createCrossWorkspaceCustomer(app, token, {
    authSubject: "ec-foreign",
    email: "ec-foreign@example.test",
    workspaceKey: uuidFromSeed(P, 9),
    customerKey: uuidFromSeed(P, 10),
    customerName: "Foreign",
  });
  const unknownId = "99999999-9999-4999-8999-999999999999";

  assertGeneric404Pair(
    await app.inject({
      method: "GET",
      url: `/v1/customers/${unknownId}`,
      headers: { authorization: `Bearer ${owner.access}` },
    }),
    await app.inject({
      method: "GET",
      url: `/v1/customers/${foreign.customer.id}`,
      headers: { authorization: `Bearer ${owner.access}` },
    }),
  );

  assertGeneric404Pair(
    await app.inject({
      method: "PATCH",
      url: `/v1/customers/${unknownId}`,
      headers: {
        authorization: `Bearer ${owner.access}`,
        "idempotency-key": uuidFromSeed(P, 11),
        "if-match": "1",
      },
      payload: { name: "Nope" },
    }),
    await app.inject({
      method: "PATCH",
      url: `/v1/customers/${foreign.customer.id}`,
      headers: {
        authorization: `Bearer ${owner.access}`,
        "idempotency-key": uuidFromSeed(P, 12),
        "if-match": "1",
      },
      payload: { name: "Nope" },
    }),
  );

  assertGeneric404Pair(
    await app.inject({
      method: "POST",
      url: `/v1/customers/${unknownId}/archive`,
      headers: {
        authorization: `Bearer ${owner.access}`,
        "idempotency-key": uuidFromSeed(P, 13),
      },
      payload: { archived: true },
    }),
    await app.inject({
      method: "POST",
      url: `/v1/customers/${foreign.customer.id}/archive`,
      headers: {
        authorization: `Bearer ${owner.access}`,
        "idempotency-key": uuidFromSeed(P, 14),
      },
      payload: { archived: true },
    }),
  );

  assertGeneric404Pair(
    await app.inject({
      method: "DELETE",
      url: `/v1/customers/${unknownId}`,
      headers: {
        authorization: `Bearer ${owner.access}`,
        "idempotency-key": uuidFromSeed(P, 15),
      },
    }),
    await app.inject({
      method: "DELETE",
      url: `/v1/customers/${foreign.customer.id}`,
      headers: {
        authorization: `Bearer ${owner.access}`,
        "idempotency-key": uuidFromSeed(P, 16),
      },
    }),
  );
});

test("Customer error contract: PATCH If-Match, VERSION_CONFLICT, duplicate, idempotency", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "ec-patch", "ec-patch@example.test", uuidFromSeed(P, 17));
  const customer = await createActiveCustomer(app, owner.access, {
    name: "Patch Target",
    email: "patch-target@example.test",
    idempotencyKey: uuidFromSeed(P, 18),
  });
  await createActiveCustomer(app, owner.access, {
    name: "Other Email",
    email: "other-email@example.test",
    idempotencyKey: uuidFromSeed(P, 19),
  });

  const missingIfMatch = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 20),
    },
    payload: { name: "No Match" },
  });
  assert.equal(missingIfMatch.statusCode, 422);
  assert.equal((missingIfMatch.json() as ErrorBody).error.code, "VALIDATION_FAILED");

  const malformedIfMatch = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 21),
      "if-match": "abc",
    },
    payload: { name: "Bad Match" },
  });
  assert.equal(malformedIfMatch.statusCode, 422);
  assert.equal((malformedIfMatch.json() as ErrorBody).error.code, "VALIDATION_FAILED");

  const ok = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 22),
      "if-match": String(customer.version),
    },
    payload: { name: "Patched Once" },
  });
  assert.equal(ok.statusCode, 200);
  const v2 = (ok.json() as { data: CustomerPublic }).data;
  assert.equal(v2.version, customer.version + 1);

  const stale = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 23),
      "if-match": String(customer.version),
    },
    payload: { name: "Should Not Win" },
  });
  assert.equal(stale.statusCode, 409);
  const staleBody = stale.json() as ErrorBody;
  assert.equal(staleBody.error.code, "VERSION_CONFLICT");
  assert.equal(staleBody.error.retryable, false);
  const server = staleBody.error.details?.server as CustomerPublic | undefined;
  assert.ok(server);
  assertCustomerPublicDto(server);
  assert.equal(server.name, "Patched Once");
  assert.equal(server.version, v2.version);
  assertNoInternalLeak(staleBody);

  const afterStale = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal((afterStale.json() as { data: { name: string } }).data.name, "Patched Once");

  const selfEmail = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 24),
      "if-match": String(v2.version),
    },
    payload: { email: "patch-target@example.test", name: "Still Self" },
  });
  assert.equal(selfEmail.statusCode, 200);
  const v3 = (selfEmail.json() as { data: CustomerPublic }).data;

  const dupEdit = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 25),
      "if-match": String(v3.version),
    },
    payload: { email: "other-email@example.test" },
  });
  assert.equal(dupEdit.statusCode, 409);
  assert.equal((dupEdit.json() as ErrorBody).error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assertNoInternalLeak(dupEdit.json());

  const patchKey = uuidFromSeed(P, 26);
  const firstPatch = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": patchKey,
      "if-match": String(v3.version),
    },
    payload: { name: "Idem Patch" },
  });
  assert.equal(firstPatch.statusCode, 200);
  const afterFirst = (firstPatch.json() as { data: CustomerPublic }).data;
  const mismatch = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": patchKey,
      "if-match": String(afterFirst.version),
    },
    payload: { name: "Different Body" },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal((mismatch.json() as ErrorBody).error.code, "IDEMPOTENCY_MISMATCH");

  const replay = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": patchKey,
      "if-match": String(v3.version),
    },
    payload: { name: "Idem Patch" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { data: { version: number } }).data.version, afterFirst.version);
});

test("Customer error contract: archive/delete auth, referenced, idempotency", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "ec-del", "ec-del@example.test", uuidFromSeed(P, 27));
  const { customer, job } = await createCustomerWithJob(app, owner.access, harness, {
    workspaceId: owner.workspaceId,
    createdBy: owner.userId,
    customerName: "Referenced",
    jobTitle: "Linked",
    customerKey: uuidFromSeed(P, 28),
    jobId: uuidFromSeed(P, 29),
  });
  const lonely = await createActiveCustomer(app, owner.access, {
    name: "Lonely",
    idempotencyKey: uuidFromSeed(P, 30),
  });

  const archiveUnauth = await app.inject({
    method: "POST",
    url: `/v1/customers/${lonely.id}/archive`,
    headers: { "idempotency-key": uuidFromSeed(P, 31) },
    payload: { archived: true },
  });
  assert.equal(archiveUnauth.statusCode, 401);
  assert.equal((archiveUnauth.json() as ErrorBody).error.code, "UNAUTHENTICATED");

  const archiveKey = uuidFromSeed(P, 32);
  const archiveFirst = await app.inject({
    method: "POST",
    url: `/v1/customers/${lonely.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": archiveKey,
    },
    payload: { archived: true },
  });
  assert.equal(archiveFirst.statusCode, 200);
  const archiveMismatch = await app.inject({
    method: "POST",
    url: `/v1/customers/${lonely.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": archiveKey,
    },
    payload: { archived: false },
  });
  assert.equal(archiveMismatch.statusCode, 409);
  assert.equal((archiveMismatch.json() as ErrorBody).error.code, "IDEMPOTENCY_MISMATCH");

  const deleteUnauth = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: { "idempotency-key": uuidFromSeed(P, 33) },
  });
  assert.equal(deleteUnauth.statusCode, 401);

  const referenced = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 34),
    },
  });
  assert.equal(referenced.statusCode, 409);
  const refBody = referenced.json() as ErrorBody;
  assert.equal(refBody.error.code, "CUSTOMER_REFERENCED");
  assert.equal(refBody.error.retryable, false);
  assert.match(refBody.error.message, /Archive/i);
  assert.equal(refBody.error.details, undefined);
  assert.equal(/job/i.test(JSON.stringify(refBody.error.details ?? {})), false);
  assertNoInternalLeak(refBody);

  const stillCustomer = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(stillCustomer.statusCode, 200);
  const stillJobs = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(
    (stillJobs.json() as { data: { items: { id: string }[] } }).data.items[0]?.id,
    job.id,
  );
  assert.equal(
    (stillCustomer.json() as { data: { archived_at: string | null } }).data.archived_at,
    null,
  );

  await app.inject({
    method: "POST",
    url: `/v1/customers/${lonely.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": uuidFromSeed(P, 35),
    },
    payload: { archived: false },
  });

  const deleteKey = uuidFromSeed(P, 36);
  const deleted = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${lonely.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": deleteKey,
    },
  });
  assert.equal(deleted.statusCode, 200);
  const deleteReplay = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${lonely.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": deleteKey,
    },
  });
  assert.equal(deleteReplay.statusCode, 200);
  assert.deepEqual((deleteReplay.json() as { data: unknown }).data, { deleted: true });

  const deleteMismatch = await app.inject({
    method: "DELETE",
    url: `/v1/customers/${customer.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": deleteKey,
    },
  });
  assert.equal(deleteMismatch.statusCode, 409);
  assert.equal((deleteMismatch.json() as ErrorBody).error.code, "IDEMPOTENCY_MISMATCH");
});
