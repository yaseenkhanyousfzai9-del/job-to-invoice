import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

const ISSUER = "http://auth.test/auth/v1";
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
    business_name: "Oak Street Repair",
    legal_name: "Oak Street Repair LLC",
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

function billingAddress() {
  return {
    line1: "200 Customer Ave",
    line2: null,
    city: "Austin",
    state: "TX",
    zip: "78702",
  };
}

function key(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

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
  return {
    access,
    userId: me.json().data.user.id as string,
    workspaceId: me.json().data.workspace.id as string,
  };
}

test("POST /v1/customers unauthenticated returns 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { "idempotency-key": key(1) },
    payload: { name: "Pat" },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHENTICATED");
  await app.close();
});

test("POST /v1/customers creates minimal and full customers", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "cust-api-min", "min@example.com", key(2));

  const minimal = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(3),
    },
    payload: { name: "Pat Minimal" },
  });
  assert.equal(minimal.statusCode, 201);
  const minimalBody = minimal.json();
  assert.equal(minimalBody.data.name, "Pat Minimal");
  assert.equal(minimalBody.data.email, null);
  assert.equal(minimalBody.data.phone, null);
  assert.equal(minimalBody.data.billing_address, null);
  assert.equal(minimalBody.data.archived_at, null);
  assert.equal(minimalBody.data.version, 1);
  assert.equal(typeof minimalBody.meta.request_id, "string");
  assert.equal(typeof minimalBody.meta.server_time, "string");
  assert.equal(Object.hasOwn(minimalBody.data, "workspace_id"), false);
  assert.equal(Object.hasOwn(minimalBody.data, "normalized_email"), false);
  assert.equal(Object.hasOwn(minimalBody.data, "created_by"), false);

  const full = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(4),
    },
    payload: {
      name: "Jordan Full",
      email: "Jordan.Full@Example.COM",
      phone: "+15551234567",
      billing_address: billingAddress(),
    },
  });
  assert.equal(full.statusCode, 201);
  assert.equal(full.json().data.email, "Jordan.Full@Example.COM");
  assert.equal(full.json().data.phone, "+15551234567");
  assert.equal(full.json().data.billing_address.state, "TX");
  assert.equal(full.json().data.version, 1);
  assert.equal(full.json().data.archived_at, null);

  const rows = harness.listCustomerRows(owner.workspaceId);
  const stored = rows.find((row) => row.id === full.json().data.id);
  assert.ok(stored);
  assert.equal(stored.normalized_email, "jordan.full@example.com");
  assert.equal(stored.workspace_id, owner.workspaceId);
  assert.equal(stored.created_by, owner.userId);
  await app.close();
});

test("POST /v1/customers validates name email phone address", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "cust-api-val", "val@example.com", key(5));
  const auth = { authorization: `Bearer ${owner.access}` };

  const badName = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(6) },
    payload: { name: "" },
  });
  assert.equal(badName.statusCode, 422);
  assert.equal(badName.json().error.code, "VALIDATION_FAILED");
  assert.ok(badName.json().error.field_errors.name);

  const badEmail = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(7) },
    payload: { name: "Pat", email: "not-an-email" },
  });
  assert.equal(badEmail.statusCode, 422);
  assert.ok(badEmail.json().error.field_errors.email);

  const badPhone = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(8) },
    payload: { name: "Pat", phone: "5125551212" },
  });
  assert.equal(badPhone.statusCode, 422);
  assert.ok(badPhone.json().error.field_errors.phone);

  const badAddress = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(9) },
    payload: {
      name: "Pat",
      billing_address: { ...billingAddress(), zip: "bad" },
    },
  });
  assert.equal(badAddress.statusCode, 422);
  assert.ok(badAddress.json().error.field_errors["billing_address.zip"]);
  await app.close();
});

test("POST /v1/customers rejects client ownership and internal fields", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "cust-api-rej", "rej@example.com", key(10));
  const auth = { authorization: `Bearer ${owner.access}` };

  const forbidden: Array<[string, Record<string, unknown>]> = [
    ["workspace_id", { name: "Pat", workspace_id: owner.workspaceId }],
    ["normalized_email", { name: "Pat", normalized_email: "x@y.com" }],
    ["version", { name: "Pat", version: 99 }],
    ["created_by", { name: "Pat", created_by: owner.userId }],
    ["id", { name: "Pat", id: "11111111-1111-4111-8111-111111111111" }],
    ["user_id", { name: "Pat", user_id: owner.userId }],
  ];
  for (const [index, [label, payload]] of forbidden.entries()) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/customers",
      headers: { ...auth, "idempotency-key": key(20 + index) },
      payload,
    });
    assert.equal(response.statusCode, 422, label);
    assert.equal(response.json().error.code, "VALIDATION_FAILED", label);
  }
  await app.close();
});

test("POST /v1/customers duplicate email warning and confirmed create", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "cust-api-dup", "dup@example.com", key(30));
  const auth = { authorization: `Bearer ${owner.access}` };

  const first = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(31) },
    payload: { name: "First Contact", email: "Shared@Example.com" },
  });
  assert.equal(first.statusCode, 201);

  const warning = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(32) },
    payload: { name: "Second Contact", email: "shared@example.com" },
  });
  assert.equal(warning.statusCode, 409);
  assert.equal(warning.json().error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assert.deepEqual(warning.json().error.details.duplicates, [
    { id: first.json().data.id, name: "First Contact" },
  ]);
  assert.equal(Object.hasOwn(warning.json().error.details.duplicates[0], "email"), false);

  const warningReplay = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(32) },
    payload: { name: "Second Contact", email: "shared@example.com" },
  });
  assert.equal(warningReplay.statusCode, 409);
  assert.equal(warningReplay.json().error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assert.equal(harness.listCustomerRows(owner.workspaceId).length, 1);

  const confirmed = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(33) },
    payload: {
      name: "Second Contact",
      email: "shared@example.com",
      confirm_duplicate_email: true,
    },
  });
  assert.equal(confirmed.statusCode, 201);
  assert.notEqual(confirmed.json().data.id, first.json().data.id);
  const rows = harness.listCustomerRows(owner.workspaceId);
  assert.equal(rows.length, 2);
  assert.equal(
    rows.filter((row) => row.normalized_email === "shared@example.com").length,
    2,
  );
  await app.close();
});

test("POST /v1/customers same-name customers and archived same-email warn", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "cust-api-name", "name@example.com", key(40));
  const auth = { authorization: `Bearer ${owner.access}` };

  const a = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(41) },
    payload: { name: "Jordan Lee" },
  });
  const b = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(42) },
    payload: { name: "Jordan Lee" },
  });
  assert.equal(a.statusCode, 201);
  assert.equal(b.statusCode, 201);
  assert.notEqual(a.json().data.id, b.json().data.id);

  const archived = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(43) },
    payload: { name: "Archived Pat", email: "archive@example.com" },
  });
  assert.equal(archived.statusCode, 201);
  harness.setCustomerArchived(
    owner.workspaceId,
    archived.json().data.id,
    new Date().toISOString(),
  );

  const warn = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": key(44) },
    payload: { name: "Active Pat", email: "archive@example.com" },
  });
  assert.equal(warn.statusCode, 409);
  assert.equal(warn.json().error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assert.equal(warn.json().error.details.duplicates[0].id, archived.json().data.id);
  await app.close();
});

test("POST /v1/customers cross-workspace duplicate email does not warn", async () => {
  const { app, token } = await createTestApp();
  const ownerA = await readyOwner(app, token, "cust-api-xa", "xa@example.com", key(50));
  const ownerB = await readyOwner(app, token, "cust-api-xb", "xb@example.com", key(51));

  const inB = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${ownerB.access}`,
      "idempotency-key": key(52),
    },
    payload: { name: "Only In B", email: "cross@example.com" },
  });
  assert.equal(inB.statusCode, 201);

  const inA = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${ownerA.access}`,
      "idempotency-key": key(53),
    },
    payload: { name: "In A", email: "cross@example.com" },
  });
  assert.equal(inA.statusCode, 201);
  await app.close();
});

test("POST /v1/customers idempotency replay and mismatch", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "cust-api-idem", "idem@example.com", key(60));
  const auth = { authorization: `Bearer ${owner.access}` };
  const idemKey = key(61);

  const first = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": idemKey },
    payload: { name: "Idempotent Pat" },
  });
  assert.equal(first.statusCode, 201);

  const replay = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": idemKey },
    payload: { name: "Idempotent Pat" },
  });
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().data.id, first.json().data.id);
  assert.equal(harness.listCustomerRows(owner.workspaceId).length, 1);

  const mismatch = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: { ...auth, "idempotency-key": idemKey },
    payload: { name: "Different Name" },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error.code, "IDEMPOTENCY_MISMATCH");
  assert.equal(harness.listCustomerRows(owner.workspaceId).length, 1);
  await app.close();
});

test("POST /v1/customers cross-tenant spoof cannot create into another workspace", async () => {
  const { app, token, harness } = await createTestApp();
  const ownerA = await readyOwner(app, token, "cust-api-sa", "sa@example.com", key(70));
  const ownerB = await readyOwner(app, token, "cust-api-sb", "sb@example.com", key(71));

  const spoof = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${ownerB.access}`,
      "idempotency-key": key(72),
    },
    payload: {
      name: "Spoof Attempt",
      workspace_id: ownerA.workspaceId,
      created_by: ownerA.userId,
    },
  });
  assert.equal(spoof.statusCode, 422);
  assert.equal(harness.listCustomerRows(ownerA.workspaceId).length, 0);
  assert.equal(harness.listCustomerRows(ownerB.workspaceId).length, 0);
  await app.close();
});
