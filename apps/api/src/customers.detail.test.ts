import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

const ISSUER = "http://auth.test/cust-api-03/v1";
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

function workspaceBody(name = "Detail Shop") {
  return {
    business_name: name,
    legal_name: `${name} LLC`,
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

async function readyOwner(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  tokenFn: Awaited<ReturnType<typeof createTestApp>>["token"],
  authSubject: string,
  email: string,
  workspaceKey: string,
) {
  const access = await tokenFn(authSubject, email);
  await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": workspaceKey,
    },
    payload: workspaceBody(email),
  });
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
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  return app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
    },
    payload: body,
  });
}

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

test("unauthenticated GET /v1/customers/{id} → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "GET",
    url: `/v1/customers/${key(1)}`,
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("same-workspace customer detail → 200 public DTO only", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-detail-ok", "ok@example.com", key(2));
  const created = await createCustomer(
    app,
    access,
    {
      name: "Detail Customer",
      email: "detail@example.com",
      phone: "+15125550100",
    },
    key(3),
  );
  assert.equal(created.statusCode, 201);
  const customer = (created.json() as { data: { id: string } }).data;

  const response = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: Record<string, unknown>; meta: { request_id: string } };
  assert.equal(body.data["id"], customer.id);
  assert.equal(body.data["name"], "Detail Customer");
  assert.equal(body.data["email"], "detail@example.com");
  assert.equal(body.data["archived_at"], null);
  assert.equal(body.data["version"], 1);
  assert.ok(body.meta.request_id);
  for (const keyName of Object.keys(body.data)) {
    assert.ok(PUBLIC_CUSTOMER_KEYS.has(keyName), `unexpected field ${keyName}`);
  }
  assert.equal("workspace_id" in body.data, false);
  assert.equal("normalized_email" in body.data, false);
  assert.equal("created_by" in body.data, false);
  assert.equal("jobs" in body.data, false);
  await app.close();
});

test("archived customer still readable by id", async () => {
  const { app, token, harness } = await createTestApp();
  const { access, workspaceId } = await readyOwner(
    app,
    token,
    "auth-detail-arch",
    "arch@example.com",
    key(4),
  );
  const created = await createCustomer(app, access, { name: "Archived One" }, key(5));
  const customer = (created.json() as { data: { id: string } }).data;
  harness.setCustomerArchived(workspaceId, customer.id, "2026-09-20T12:00:00.000Z");

  const response = await app.inject({
    method: "GET",
    url: `/v1/customers/${customer.id}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { data: { archived_at: string; name: string } };
  assert.equal(body.data.name, "Archived One");
  assert.equal(body.data.archived_at, "2026-09-20T12:00:00.000Z");
  await app.close();
});

test("unknown and cross-workspace customer → identical generic 404", async () => {
  const { app, token } = await createTestApp();
  const a = await readyOwner(app, token, "auth-detail-a", "a@example.com", key(6));
  const b = await readyOwner(app, token, "auth-detail-b", "b@example.com", key(7));
  const createdB = await createCustomer(app, b.access, { name: "Tenant B" }, key(8));
  const customerB = (createdB.json() as { data: { id: string; name: string } }).data;

  const unknownId = key(9);
  const unknown = await app.inject({
    method: "GET",
    url: `/v1/customers/${unknownId}`,
    headers: { authorization: `Bearer ${a.access}` },
  });
  const foreign = await app.inject({
    method: "GET",
    url: `/v1/customers/${customerB.id}`,
    headers: { authorization: `Bearer ${a.access}` },
  });

  assert.equal(unknown.statusCode, 404);
  assert.equal(foreign.statusCode, 404);
  const unknownBody = unknown.json() as {
    error: { code: string; message: string; field_errors: Record<string, string[]> };
  };
  const foreignBody = foreign.json() as {
    error: { code: string; message: string; field_errors: Record<string, string[]> };
  };
  assert.equal(unknownBody.error.code, "NOT_FOUND");
  assert.equal(foreignBody.error.code, "NOT_FOUND");
  assert.equal(unknownBody.error.message, foreignBody.error.message);
  assert.deepEqual(unknownBody.error.field_errors, {});
  assert.deepEqual(foreignBody.error.field_errors, {});
  assert.equal(JSON.stringify(foreignBody).includes(customerB.name), false);
  assert.equal(JSON.stringify(foreignBody).includes(customerB.id), false);
  await app.close();
});

test("malformed customer id → 422", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-detail-bad", "bad@example.com", key(10));
  const response = await app.inject({
    method: "GET",
    url: "/v1/customers/not-a-uuid",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 422);
  const body = response.json() as { error: { code: string } };
  assert.equal(body.error.code, "VALIDATION_FAILED");
  await app.close();
});
