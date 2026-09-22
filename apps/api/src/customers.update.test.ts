import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

const ISSUER = "http://auth.test/cust-api-04/v1";
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

function billingAddress(zip = "78702") {
  return {
    line1: "200 Customer Ave",
    line2: null,
    city: "Austin",
    state: "TX",
    zip,
  };
}

function key(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `cccccccc-cccc-4ccc-8ccc-${hex}`;
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
  return {
    access,
    workspaceId: (me.json() as { data: { workspace: { id: string } } }).data.workspace.id,
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

async function patchCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  customerId: string,
  version: number,
  payload: Record<string, unknown>,
  idempotencyKey: string,
) {
  return app.inject({
    method: "PATCH",
    url: `/v1/customers/${customerId}`,
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
      "if-match": String(version),
    },
    payload,
  });
}

test("PATCH /v1/customers/{id} unauthenticated returns 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "PATCH",
    url: "/v1/customers/11111111-1111-4111-8111-111111111111",
    headers: {
      "idempotency-key": key(1),
      "if-match": "1",
    },
    payload: { name: "Nope" },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("same-workspace PATCH updates fields, increments version, preserves omitted", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-patch-ok", "patch-ok@example.com", key(2));
  const created = await createCustomer(
    app,
    access,
    {
      name: "Original Name",
      email: "keep@example.com",
      phone: "+15551234567",
      billing_address: billingAddress(),
    },
    key(3),
  );
  assert.equal(created.version, 1);

  const nameOnly = await patchCustomer(app, access, created.id, 1, { name: "New Name" }, key(4));
  assert.equal(nameOnly.statusCode, 200);
  const afterName = (nameOnly.json() as { data: CustomerData }).data;
  assert.equal(afterName.name, "New Name");
  assert.equal(afterName.email, "keep@example.com");
  assert.equal(afterName.phone, "+15551234567");
  assert.deepEqual(afterName.billing_address, billingAddress());
  assert.equal(afterName.version, 2);

  const emailOnly = await patchCustomer(
    app,
    access,
    created.id,
    2,
    { email: "changed@example.com" },
    key(5),
  );
  assert.equal(emailOnly.statusCode, 200);
  const afterEmail = (emailOnly.json() as { data: CustomerData }).data;
  assert.equal(afterEmail.name, "New Name");
  assert.equal(afterEmail.email, "changed@example.com");
  assert.equal(afterEmail.phone, "+15551234567");
  assert.equal(afterEmail.version, 3);

  const phoneOnly = await patchCustomer(app, access, created.id, 3, { phone: "+15557654321" }, key(6));
  assert.equal(phoneOnly.statusCode, 200);
  assert.equal((phoneOnly.json() as { data: CustomerData }).data.phone, "+15557654321");
  assert.equal((phoneOnly.json() as { data: CustomerData }).data.version, 4);

  const addressOnly = await patchCustomer(
    app,
    access,
    created.id,
    4,
    { billing_address: billingAddress("78703") },
    key(7),
  );
  assert.equal(addressOnly.statusCode, 200);
  const afterAddress = (addressOnly.json() as { data: CustomerData }).data;
  assert.deepEqual(afterAddress.billing_address, billingAddress("78703"));
  assert.equal(afterAddress.email, "changed@example.com");
  assert.equal(afterAddress.version, 5);
  await app.close();
});

test("optional field clearing and public DTO shape", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-clear", "clear@example.com", key(8));
  const created = await createCustomer(
    app,
    owner.access,
    {
      name: "Clearable",
      email: "clear-me@example.com",
      phone: "+15551112222",
      billing_address: billingAddress(),
    },
    key(9),
  );

  const cleared = await patchCustomer(
    app,
    owner.access,
    created.id,
    1,
    { email: null, phone: null, billing_address: null },
    key(10),
  );
  assert.equal(cleared.statusCode, 200);
  const data = (cleared.json() as { data: CustomerData }).data;
  assert.equal(data.email, null);
  assert.equal(data.phone, null);
  assert.equal(data.billing_address, null);
  assert.equal(data.version, 2);
  assert.equal(data.name, "Clearable");
  assert.ok(!("workspace_id" in data));
  assert.ok(!("normalized_email" in data));
  assert.ok(!("created_by" in data));

  const row = harness.listCustomerRows(owner.workspaceId).find((item) => item.id === created.id);
  assert.equal(row?.normalized_email, null);
  await app.close();
});

test("If-Match missing/malformed/stale; stale write does not mutate", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-ifmatch", "ifmatch@example.com", key(11));
  const created = await createCustomer(app, owner.access, { name: "Versioned" }, key(12));

  const missing = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${created.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(13),
    },
    payload: { name: "No Match" },
  });
  assert.equal(missing.statusCode, 422);
  assert.ok(
    (missing.json() as { error: { field_errors: Record<string, string[]> } }).error.field_errors[
      "If-Match"
    ],
  );

  const malformed = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${created.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(14),
      "if-match": "abc",
    },
    payload: { name: "Bad Match" },
  });
  assert.equal(malformed.statusCode, 422);

  const first = await patchCustomer(app, owner.access, created.id, 1, { name: "V2" }, key(15));
  assert.equal(first.statusCode, 200);
  assert.equal((first.json() as { data: CustomerData }).data.version, 2);

  const stale = await patchCustomer(app, owner.access, created.id, 1, { name: "Stale" }, key(16));
  assert.equal(stale.statusCode, 409);
  const staleBody = stale.json() as {
    error: { code: string; details?: { server?: CustomerData } };
  };
  assert.equal(staleBody.error.code, "VERSION_CONFLICT");
  assert.equal(staleBody.error.details?.server?.name, "V2");
  assert.equal(staleBody.error.details?.server?.version, 2);

  const row = harness.listCustomerRows(owner.workspaceId).find((item) => item.id === created.id);
  assert.equal(row?.name, "V2");
  assert.equal(row?.version, 2);
  await app.close();
});

test("unknown and cross-workspace PATCH return identical generic 404", async () => {
  const { app, token } = await createTestApp();
  const a = await readyOwner(app, token, "auth-a", "a@example.com", key(20));
  const b = await readyOwner(app, token, "auth-b", "b@example.com", key(21));
  const createdB = await createCustomer(app, b.access, { name: "Tenant B" }, key(22));

  const unknown = await patchCustomer(
    app,
    a.access,
    "99999999-9999-4999-8999-999999999999",
    1,
    { name: "Ghost" },
    key(23),
  );
  const cross = await patchCustomer(app, a.access, createdB.id, 1, { name: "Steal" }, key(24));
  assert.equal(unknown.statusCode, 404);
  assert.equal(cross.statusCode, 404);
  assert.equal(
    (unknown.json() as { error: { code: string; message: string } }).error.code,
    (cross.json() as { error: { code: string; message: string } }).error.code,
  );
  assert.equal(
    (unknown.json() as { error: { message: string } }).error.message,
    (cross.json() as { error: { message: string } }).error.message,
  );
  assert.equal(
    (unknown.json() as { error: { details?: unknown } }).error.details,
    undefined,
  );
  await app.close();
});

test("rejects internal fields and validates contact inputs", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-val", "val@example.com", key(25));
  const created = await createCustomer(app, access, { name: "Validatable" }, key(26));

  const ownership = await patchCustomer(
    app,
    access,
    created.id,
    1,
    { name: "X", workspace_id: "11111111-1111-4111-8111-111111111111" },
    key(27),
  );
  assert.equal(ownership.statusCode, 422);

  const versionField = await patchCustomer(
    app,
    access,
    created.id,
    1,
    { version: 99, name: "X" },
    key(28),
  );
  assert.equal(versionField.statusCode, 422);

  const badName = await patchCustomer(app, access, created.id, 1, { name: "" }, key(29));
  assert.equal(badName.statusCode, 422);

  const badEmail = await patchCustomer(app, access, created.id, 1, { email: "not-an-email" }, key(30));
  assert.equal(badEmail.statusCode, 422);

  const badPhone = await patchCustomer(app, access, created.id, 1, { phone: "5125551212" }, key(31));
  assert.equal(badPhone.statusCode, 422);

  const badAddress = await patchCustomer(
    app,
    access,
    created.id,
    1,
    { billing_address: { line1: "1", city: "Austin", state: "Texas", zip: "78701" } },
    key(32),
  );
  assert.equal(badAddress.statusCode, 422);
  await app.close();
});

test("duplicate email on edit warns, confirms, ignores self and cross-workspace", async () => {
  const { app, token } = await createTestApp();
  const a = await readyOwner(app, token, "auth-dup-a", "dup-a@example.com", key(40));
  const b = await readyOwner(app, token, "auth-dup-b", "dup-b@example.com", key(41));

  const first = await createCustomer(
    app,
    a.access,
    { name: "First", email: "shared@example.com" },
    key(42),
  );
  const second = await createCustomer(app, a.access, { name: "Second", email: "other@example.com" }, key(43));
  await createCustomer(app, b.access, { name: "Foreign", email: "foreign-dup@example.com" }, key(44));

  const selfSame = await patchCustomer(
    app,
    a.access,
    first.id,
    1,
    { email: "shared@example.com", name: "First Renamed" },
    key(45),
  );
  assert.equal(selfSame.statusCode, 200);
  assert.equal((selfSame.json() as { data: CustomerData }).data.version, 2);

  const warn = await patchCustomer(
    app,
    a.access,
    second.id,
    1,
    { email: "shared@example.com" },
    key(46),
  );
  assert.equal(warn.statusCode, 409);
  const warnBody = warn.json() as {
    error: { code: string; details: { duplicates: { id: string; name: string }[] } };
  };
  assert.equal(warnBody.error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assert.equal(warnBody.error.details.duplicates.length, 1);
  assert.equal(warnBody.error.details.duplicates[0]?.id, first.id);

  const confirmed = await patchCustomer(
    app,
    a.access,
    second.id,
    1,
    { email: "shared@example.com", confirm_duplicate_email: true },
    key(47),
  );
  assert.equal(confirmed.statusCode, 200);
  assert.equal((confirmed.json() as { data: CustomerData }).data.email, "shared@example.com");
  assert.equal((confirmed.json() as { data: CustomerData }).data.version, 2);

  const crossEmail = await patchCustomer(
    app,
    a.access,
    first.id,
    2,
    { email: "foreign-dup@example.com" },
    key(48),
  );
  assert.equal(crossEmail.statusCode, 200);
  await app.close();
});

test("archived customer contact fields remain editable", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-arch", "arch@example.com", key(50));
  const created = await createCustomer(app, owner.access, { name: "Archived Edit" }, key(51));
  harness.setCustomerArchived(owner.workspaceId, created.id, "2026-09-21T12:00:00.000Z");

  const patched = await patchCustomer(
    app,
    owner.access,
    created.id,
    1,
    { name: "Still Editable" },
    key(52),
  );
  assert.equal(patched.statusCode, 200);
  const data = (patched.json() as { data: CustomerData }).data;
  assert.equal(data.name, "Still Editable");
  assert.equal(data.archived_at, "2026-09-21T12:00:00.000Z");
  assert.equal(data.version, 2);
  await app.close();
});

test("PATCH idempotency replay and mismatch; replay ignores stale If-Match", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-idem", "idem@example.com", key(60));
  const created = await createCustomer(app, owner.access, { name: "Idem" }, key(61));
  const idemKey = key(62);

  const first = await patchCustomer(app, owner.access, created.id, 1, { name: "Once" }, idemKey);
  assert.equal(first.statusCode, 200);
  assert.equal((first.json() as { data: CustomerData }).data.version, 2);

  const replay = await patchCustomer(app, owner.access, created.id, 1, { name: "Once" }, idemKey);
  assert.equal(replay.statusCode, 200);
  assert.equal((replay.json() as { data: CustomerData }).data.version, 2);
  assert.equal((replay.json() as { data: CustomerData }).data.name, "Once");

  const rows = harness.listCustomerRows(owner.workspaceId).filter((row) => row.id === created.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.version, 2);

  const mismatch = await patchCustomer(
    app,
    owner.access,
    created.id,
    2,
    { name: "Different" },
    idemKey,
  );
  assert.equal(mismatch.statusCode, 409);
  assert.equal(
    (mismatch.json() as { error: { code: string } }).error.code,
    "IDEMPOTENCY_MISMATCH",
  );

  const missingKey = await app.inject({
    method: "PATCH",
    url: `/v1/customers/${created.id}`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "if-match": "2",
    },
    payload: { name: "No Key" },
  });
  assert.equal(missingKey.statusCode, 422);
  await app.close();
});
