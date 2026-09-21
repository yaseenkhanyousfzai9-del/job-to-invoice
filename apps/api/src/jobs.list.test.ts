import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

const ISSUER = "http://auth.test/cust-api-03-jobs/v1";
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

function workspaceBody(name = "Jobs Shop") {
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
  return `eeeeeeee-eeee-4eee-8eee-${hex}`;
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

const PUBLIC_JOB_KEYS = new Set(["id", "title", "lifecycle", "updated_at", "customer_id"]);

test("unauthenticated GET /v1/jobs → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${key(1)}`,
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("same-workspace customer with no jobs → 200 empty list", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-jobs-empty", "empty@example.com", key(2));
  const created = await createCustomer(app, access, { name: "No Jobs" }, key(3));
  const customer = (created.json() as { data: { id: string } }).data;

  const response = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { items: unknown[]; next_cursor: string | null };
  };
  assert.deepEqual(body.data.items, []);
  assert.equal(body.data.next_cursor, null);
  await app.close();
});

test("jobs for customer returned in (updated_at, id) DESC; other customer excluded", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-jobs-order", "order@example.com", key(4));
  const c1 = await createCustomer(app, owner.access, { name: "Cust One" }, key(5));
  const c2 = await createCustomer(app, owner.access, { name: "Cust Two" }, key(6));
  const customer1 = (c1.json() as { data: { id: string } }).data;
  const customer2 = (c2.json() as { data: { id: string } }).data;

  const older = await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer1.id,
    createdBy: owner.userId,
    title: "Older Job",
    updatedAt: "2026-09-18T10:00:00.000Z",
    id: key(20),
  });
  const newer = await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer1.id,
    createdBy: owner.userId,
    title: "Newer Job",
    updatedAt: "2026-09-19T10:00:00.000Z",
    id: key(21),
  });
  await harness.createJob({
    workspaceId: owner.workspaceId,
    customerId: customer2.id,
    createdBy: owner.userId,
    title: "Other Customer Job",
    updatedAt: "2026-09-20T10:00:00.000Z",
    id: key(22),
  });

  const response = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer1.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: {
      items: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
  };
  assert.equal(body.data.items.length, 2);
  assert.equal(body.data.items[0]?.["id"], newer.id);
  assert.equal(body.data.items[1]?.["id"], older.id);
  assert.equal(
    body.data.items.some((item) => item["title"] === "Other Customer Job"),
    false,
  );
  for (const item of body.data.items) {
    for (const field of Object.keys(item)) {
      assert.ok(PUBLIC_JOB_KEYS.has(field), `unexpected job field ${field}`);
    }
    assert.equal("workspace_id" in item, false);
    assert.equal("created_by" in item, false);
    assert.equal("internal_notes" in item, false);
    assert.equal("entitlement_origin" in item, false);
    assert.equal("version" in item, false);
  }
  await app.close();
});

test("unknown and cross-workspace customer_id → identical generic 404", async () => {
  const { app, token, harness } = await createTestApp();
  const a = await readyOwner(app, token, "auth-jobs-a", "ja@example.com", key(7));
  const b = await readyOwner(app, token, "auth-jobs-b", "jb@example.com", key(8));
  const createdB = await createCustomer(app, b.access, { name: "B Customer" }, key(9));
  const customerB = (createdB.json() as { data: { id: string; name: string } }).data;
  await harness.createJob({
    workspaceId: b.workspaceId,
    customerId: customerB.id,
    createdBy: b.userId,
    title: "Secret Job",
    id: key(23),
  });

  const unknownId = key(10);
  const unknown = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${unknownId}`,
    headers: { authorization: `Bearer ${a.access}` },
  });
  const foreign = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customerB.id}`,
    headers: { authorization: `Bearer ${a.access}` },
  });

  assert.equal(unknown.statusCode, 404);
  assert.equal(foreign.statusCode, 404);
  const unknownBody = unknown.json() as { error: { code: string; message: string } };
  const foreignBody = foreign.json() as { error: { code: string; message: string } };
  assert.equal(unknownBody.error.code, "NOT_FOUND");
  assert.equal(foreignBody.error.code, "NOT_FOUND");
  assert.equal(unknownBody.error.message, foreignBody.error.message);
  assert.equal(JSON.stringify(foreignBody).includes("Secret Job"), false);
  assert.equal(JSON.stringify(foreignBody).includes(customerB.name), false);
  await app.close();
});

test("malformed customer_id → 422; missing customer_id → 422", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-jobs-bad", "badj@example.com", key(11));
  const malformed = await app.inject({
    method: "GET",
    url: "/v1/jobs?customer_id=not-a-uuid",
    headers: { authorization: `Bearer ${access}` },
  });
  const missing = await app.inject({
    method: "GET",
    url: "/v1/jobs",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(malformed.statusCode, 422);
  assert.equal(missing.statusCode, 422);
  await app.close();
});

test("jobs pagination cursor returns deterministic pages", async () => {
  const { app, token, harness } = await createTestApp();
  const owner = await readyOwner(app, token, "auth-jobs-page", "page@example.com", key(12));
  const created = await createCustomer(app, owner.access, { name: "Paged" }, key(13));
  const customer = (created.json() as { data: { id: string } }).data;

  for (let i = 0; i < 3; i += 1) {
    await harness.createJob({
      workspaceId: owner.workspaceId,
      customerId: customer.id,
      createdBy: owner.userId,
      title: `Job ${i}`,
      updatedAt: `2026-09-1${i}T10:00:00.000Z`,
      id: key(30 + i),
    });
  }

  const first = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}&limit=2`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(first.statusCode, 200);
  const firstBody = first.json() as {
    data: { items: Array<{ id: string; title: string }>; next_cursor: string | null };
  };
  assert.equal(firstBody.data.items.length, 2);
  assert.ok(firstBody.data.next_cursor);
  assert.equal(firstBody.data.items[0]?.title, "Job 2");
  assert.equal(firstBody.data.items[1]?.title, "Job 1");

  const second = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}&limit=2&cursor=${encodeURIComponent(firstBody.data.next_cursor!)}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(second.statusCode, 200);
  const secondBody = second.json() as {
    data: { items: Array<{ title: string }>; next_cursor: string | null };
  };
  assert.equal(secondBody.data.items.length, 1);
  assert.equal(secondBody.data.items[0]?.title, "Job 0");
  assert.equal(secondBody.data.next_cursor, null);
  await app.close();
});
