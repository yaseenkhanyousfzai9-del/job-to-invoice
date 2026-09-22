import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

const ISSUER = "http://auth.test/jobs-create/v1";
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

function siteAddress() {
  return {
    line1: "500 Site Rd",
    line2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
  };
}

function key(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

function jobId(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `cccccccc-cccc-4ccc-8ccc-${hex}`;
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

async function createCustomer(
  app: Awaited<ReturnType<typeof createTestApp>>["app"],
  access: string,
  name: string,
  idempotencyKey: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/customers",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": idempotencyKey,
    },
    payload: { name },
  });
  assert.equal(response.statusCode, 201);
  return response.json().data as { id: string; name: string };
}

test("unauthenticated POST /v1/jobs → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { "idempotency-key": key(1) },
    payload: {
      id: jobId(1),
      customer_id: key(2),
      title: "Fence",
      no_site: true,
      mode: "quote",
    },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHENTICATED");
  await app.close();
});

test("missing Idempotency-Key → 422", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "jobs-create-nokey", "nokey@example.com", key(3));
  const customer = await createCustomer(app, owner.access, "Cust", key(4));
  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: { authorization: `Bearer ${owner.access}` },
    payload: {
      id: jobId(2),
      customer_id: customer.id,
      title: "Fence",
      no_site: true,
      mode: "quote",
    },
  });
  assert.equal(response.statusCode, 422);
  await app.close();
});

test("valid same-workspace Customer creates draft Job with defaults", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "jobs-create-ok", "ok@example.com", key(5));
  const customer = await createCustomer(app, owner.access, "Active Cust", key(6));
  const other = await createCustomer(app, owner.access, "Other Cust", key(7));

  const created = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(8),
    },
    payload: {
      id: jobId(3),
      customer_id: customer.id,
      title: "  Fence repair  ",
      no_site: false,
      site_address: siteAddress(),
      mode: "quote",
      workspace_id: "should-be-rejected-if-allowed",
    },
  });
  // workspace_id rejected at parse
  assert.equal(created.statusCode, 422);

  const ok = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(9),
    },
    payload: {
      id: jobId(3),
      customer_id: customer.id,
      title: "  Fence repair  ",
      no_site: false,
      site_address: siteAddress(),
      mode: "quote",
    },
  });
  assert.equal(ok.statusCode, 201);
  const job = ok.json().data as Record<string, unknown>;
  assert.equal(job["id"], jobId(3));
  assert.equal(job["customer_id"], customer.id);
  assert.equal(job["title"], "Fence repair");
  assert.equal(job["lifecycle"], "draft");
  assert.equal(job["version"], 1);
  assert.equal(job["scope_version"], 0);
  assert.equal(job["no_site"], false);
  assert.equal(job["mode"], "quote");
  assert.equal((job["site_address"] as { line1: string }).line1, "500 Site Rd");
  assert.deepEqual(job["customer"], { id: customer.id, name: "Active Cust" });
  assert.equal(job["workspace_id"], undefined);
  assert.equal(job["created_by"], undefined);
  assert.equal(job["internal_notes"], undefined);
  assert.equal(job["entitlement_origin"], undefined);
  assert.equal(job["completion_right"], undefined);

  const list = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(list.statusCode, 200);
  const items = list.json().data.items as { id: string }[];
  assert.equal(items.some((row) => row.id === jobId(3)), true);

  const otherList = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${other.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(otherList.statusCode, 200);
  assert.equal(otherList.json().data.items.length, 0);

  await app.close();
});

test("no_site true persists without site address", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "jobs-create-nosite", "nosite@example.com", key(10));
  const customer = await createCustomer(app, owner.access, "Remote", key(11));
  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(12),
    },
    payload: {
      id: jobId(4),
      customer_id: customer.id,
      title: "Remote consult",
      no_site: true,
      site_address: null,
      mode: "direct_invoice",
    },
  });
  assert.equal(response.statusCode, 201);
  const job = response.json().data;
  assert.equal(job.no_site, true);
  assert.equal(job.site_address, null);
  assert.equal(job.mode, "direct_invoice");
  await app.close();
});

test("title and site validation", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "jobs-create-val", "val@example.com", key(13));
  const customer = await createCustomer(app, owner.access, "Val Cust", key(14));

  const emptyTitle = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(15),
    },
    payload: {
      id: jobId(5),
      customer_id: customer.id,
      title: "   ",
      no_site: true,
      mode: "quote",
    },
  });
  assert.equal(emptyTitle.statusCode, 422);

  const badSite = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(16),
    },
    payload: {
      id: jobId(6),
      customer_id: customer.id,
      title: "Bad site",
      no_site: false,
      site_address: { ...siteAddress(), zip: "12" },
      mode: "quote",
    },
  });
  assert.equal(badSite.statusCode, 422);

  const serverOwned = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(17),
    },
    payload: {
      id: jobId(7),
      customer_id: customer.id,
      title: "Owned",
      no_site: true,
      mode: "quote",
      lifecycle: "active",
      version: 9,
      scope_version: 3,
      internal_notes: "secret",
    },
  });
  assert.equal(serverOwned.statusCode, 422);
  await app.close();
});

test("unknown and cross-workspace Customer → identical generic 404", async () => {
  const { app, token } = await createTestApp();
  const a = await readyOwner(app, token, "jobs-create-a", "a@example.com", key(20));
  const b = await readyOwner(app, token, "jobs-create-b", "b@example.com", key(21));
  const foreign = await createCustomer(app, b.access, "Foreign", key(22));
  await createCustomer(app, a.access, "Own", key(23));

  const unknown = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${a.access}`,
      "idempotency-key": key(24),
    },
    payload: {
      id: jobId(8),
      customer_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "X",
      no_site: true,
      mode: "quote",
    },
  });
  const cross = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${a.access}`,
      "idempotency-key": key(25),
    },
    payload: {
      id: jobId(9),
      customer_id: foreign.id,
      title: "X",
      no_site: true,
      mode: "quote",
    },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(cross.statusCode, 404);
  assert.equal(unknown.json().error.code, cross.json().error.code);
  assert.equal(unknown.json().error.message, cross.json().error.message);
  await app.close();
});

test("archived Customer → 422 CUSTOMER_ARCHIVED", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "jobs-create-arch", "arch@example.com", key(30));
  const customer = await createCustomer(app, owner.access, "Archived", key(31));
  const archive = await app.inject({
    method: "POST",
    url: `/v1/customers/${customer.id}/archive`,
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(32),
    },
    payload: { archived: true },
  });
  assert.equal(archive.statusCode, 200);

  const response = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(33),
    },
    payload: {
      id: jobId(10),
      customer_id: customer.id,
      title: "Should fail",
      no_site: true,
      mode: "quote",
    },
  });
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, "CUSTOMER_ARCHIVED");
  await app.close();
});

test("idempotency replay and mismatch", async () => {
  const { app, token } = await createTestApp();
  const owner = await readyOwner(app, token, "jobs-create-idem", "idem@example.com", key(40));
  const customer = await createCustomer(app, owner.access, "Idem Cust", key(41));
  const payload = {
    id: jobId(11),
    customer_id: customer.id,
    title: "Idem Job",
    no_site: true,
    mode: "quote" as const,
  };
  const first = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(42),
    },
    payload,
  });
  assert.equal(first.statusCode, 201);
  const firstId = first.json().data.id as string;

  const replay = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(42),
    },
    payload,
  });
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().data.id, firstId);

  const list = await app.inject({
    method: "GET",
    url: `/v1/jobs?customer_id=${customer.id}`,
    headers: { authorization: `Bearer ${owner.access}` },
  });
  assert.equal(list.json().data.items.length, 1);

  const mismatch = await app.inject({
    method: "POST",
    url: "/v1/jobs",
    headers: {
      authorization: `Bearer ${owner.access}`,
      "idempotency-key": key(42),
    },
    payload: { ...payload, title: "Different" },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error.code, "IDEMPOTENCY_MISMATCH");
  await app.close();
});
