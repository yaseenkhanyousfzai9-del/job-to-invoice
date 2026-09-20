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

function workspaceBody(name = "Oak Street Repair") {
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
  return `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
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
  const workspaceId = (me.json() as { data: { workspace: { id: string } } }).data.workspace.id;
  return { access, workspaceId };
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

test("unauthenticated GET /v1/customers → 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({ method: "GET", url: "/v1/customers" });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("authenticated empty workspace → 200 empty list", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-empty", "empty@example.com", key(1));
  const response = await app.inject({
    method: "GET",
    url: "/v1/customers",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    data: { items: unknown[]; next_cursor: string | null };
    meta: { request_id: string };
  };
  assert.deepEqual(body.data.items, []);
  assert.equal(body.data.next_cursor, null);
  assert.ok(body.meta.request_id);
  await app.close();
});

test("default list returns active only; archived excluded; state filters work", async () => {
  const { app, token, harness } = await createTestApp();
  const { access, workspaceId } = await readyOwner(
    app,
    token,
    "auth-state",
    "state@example.com",
    key(2),
  );
  const active = await createCustomer(
    app,
    access,
    { name: "Active Customer" },
    key(3),
  );
  assert.equal(active.statusCode, 201);
  const archivedCreate = await createCustomer(
    app,
    access,
    { name: "Archived Customer" },
    key(4),
  );
  assert.equal(archivedCreate.statusCode, 201);
  const archivedId = (archivedCreate.json() as { data: { id: string } }).data.id;
  harness.setCustomerArchived(workspaceId, archivedId, "2026-09-20T10:00:00.000Z");

  const defaults = await app.inject({
    method: "GET",
    url: "/v1/customers",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(defaults.statusCode, 200);
  const defaultItems = (defaults.json() as { data: { items: { name: string }[] } }).data.items;
  assert.equal(defaultItems.length, 1);
  assert.equal(defaultItems[0]?.name, "Active Customer");

  const archivedOnly = await app.inject({
    method: "GET",
    url: "/v1/customers?state=archived",
    headers: { authorization: `Bearer ${access}` },
  });
  const archivedItems = (archivedOnly.json() as { data: { items: { name: string }[] } }).data
    .items;
  assert.equal(archivedItems.length, 1);
  assert.equal(archivedItems[0]?.name, "Archived Customer");

  const all = await app.inject({
    method: "GET",
    url: "/v1/customers?state=all",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal((all.json() as { data: { items: unknown[] } }).data.items.length, 2);
  await app.close();
});

test("search by partial name, email, case-insensitive; no-match empty", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-search", "search@example.com", key(5));
  await createCustomer(
    app,
    access,
    { name: "Jordan Lee", email: "Jordan.Lee@Example.com" },
    key(6),
  );
  await createCustomer(app, access, { name: "Sam Other" }, key(7));

  const byName = await app.inject({
    method: "GET",
    url: "/v1/customers?search=jordan",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(byName.statusCode, 200);
  assert.equal((byName.json() as { data: { items: unknown[] } }).data.items.length, 1);

  const byEmail = await app.inject({
    method: "GET",
    url: "/v1/customers?search=jordan.lee@example.com",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal((byEmail.json() as { data: { items: unknown[] } }).data.items.length, 1);

  const none = await app.inject({
    method: "GET",
    url: "/v1/customers?search=zzzz-no-match",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal((none.json() as { data: { items: unknown[] } }).data.items.length, 0);
  await app.close();
});

test("workspace isolation and duplicate-email customers both appear", async () => {
  const { app, token } = await createTestApp();
  const a = await readyOwner(app, token, "auth-a", "owner-a@example.com", key(8));
  const b = await readyOwner(app, token, "auth-b", "owner-b@example.com", key(9));
  await createCustomer(
    app,
    a.access,
    { name: "Shared Email One", email: "dup@example.com" },
    key(10),
  );
  await createCustomer(
    app,
    a.access,
    {
      name: "Shared Email Two",
      email: "dup@example.com",
      confirm_duplicate_email: true,
    },
    key(11),
  );
  await createCustomer(app, b.access, { name: "Tenant B Only", email: "b@example.com" }, key(12));

  const listA = await app.inject({
    method: "GET",
    url: "/v1/customers",
    headers: { authorization: `Bearer ${a.access}` },
  });
  const itemsA = (listA.json() as { data: { items: { name: string }[] } }).data.items;
  assert.equal(itemsA.length, 2);
  assert.ok(itemsA.every((item) => item.name.startsWith("Shared Email")));

  const listB = await app.inject({
    method: "GET",
    url: "/v1/customers",
    headers: { authorization: `Bearer ${b.access}` },
  });
  const itemsB = (listB.json() as { data: { items: { name: string }[] } }).data.items;
  assert.equal(itemsB.length, 1);
  assert.equal(itemsB[0]?.name, "Tenant B Only");
  await app.close();
});

test("deterministic order, limit, cursor pagination without duplicates", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-page", "page@example.com", key(13));
  for (let i = 1; i <= 5; i += 1) {
    const response = await createCustomer(
      app,
      access,
      { name: `Customer ${i}` },
      key(20 + i),
    );
    assert.equal(response.statusCode, 201);
  }

  const page1 = await app.inject({
    method: "GET",
    url: "/v1/customers?limit=2",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(page1.statusCode, 200);
  const body1 = page1.json() as {
    data: { items: { id: string; name: string; updated_at: string }[]; next_cursor: string | null };
  };
  assert.equal(body1.data.items.length, 2);
  assert.ok(body1.data.next_cursor);
  assert.ok(body1.data.items[0]!.updated_at >= body1.data.items[1]!.updated_at);

  const page2 = await app.inject({
    method: "GET",
    url: `/v1/customers?limit=2&cursor=${encodeURIComponent(body1.data.next_cursor!)}`,
    headers: { authorization: `Bearer ${access}` },
  });
  const body2 = page2.json() as {
    data: { items: { id: string }[]; next_cursor: string | null };
  };
  assert.equal(body2.data.items.length, 2);
  const ids = [...body1.data.items, ...body2.data.items].map((item) => item.id);
  assert.equal(new Set(ids).size, 4);

  const page3 = await app.inject({
    method: "GET",
    url: `/v1/customers?limit=2&cursor=${encodeURIComponent(body2.data.next_cursor!)}`,
    headers: { authorization: `Bearer ${access}` },
  });
  const body3 = page3.json() as {
    data: { items: { id: string }[]; next_cursor: string | null };
  };
  assert.equal(body3.data.items.length, 1);
  assert.equal(body3.data.next_cursor, null);
  assert.ok(!ids.includes(body3.data.items[0]!.id));
  await app.close();
});

test("malformed cursor / invalid state / invalid limits → 422; no internal field leak", async () => {
  const { app, token } = await createTestApp();
  const { access } = await readyOwner(app, token, "auth-val", "val@example.com", key(14));
  await createCustomer(app, access, { name: "Visible" }, key(15));

  for (const url of [
    "/v1/customers?cursor=not-valid",
    "/v1/customers?state=banana",
    "/v1/customers?limit=0",
    "/v1/customers?limit=101",
    "/v1/customers?limit=abc",
  ]) {
    const response = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${access}` },
    });
    assert.equal(response.statusCode, 422, url);
  }

  const ok = await app.inject({
    method: "GET",
    url: "/v1/customers",
    headers: { authorization: `Bearer ${access}` },
  });
  const item = (ok.json() as { data: { items: Record<string, unknown>[] } }).data.items[0]!;
  assert.equal(Object.prototype.hasOwnProperty.call(item, "workspace_id"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, "created_by"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(item, "normalized_email"), false);
  assert.ok(item["id"]);
  assert.ok(item["name"]);
  assert.ok("email" in item);
  assert.ok("phone" in item);
  assert.ok("billing_address" in item);
  assert.ok("archived_at" in item);
  assert.ok("version" in item);
  assert.ok("created_at" in item);
  assert.ok("updated_at" in item);
  await app.close();
});
