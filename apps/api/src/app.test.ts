import assert from "node:assert/strict";
import { test } from "node:test";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { buildApp } from "./app.ts";
import { createStaticKeyVerifier } from "./auth/jwt.ts";
import { createMemoryAuthStore } from "./store/memory.ts";

test("GET /health returns ok without secrets", async () => {
  const harness = createMemoryAuthStore();
  const { publicKey } = await generateKeyPair("RS256");
  const app = await buildApp({
    jwtVerifier: createStaticKeyVerifier({
      key: publicKey,
      issuer: "http://auth.test/auth/v1",
      audience: "authenticated",
    }),
    store: harness.store,
  });
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});

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
  async function token(subject: string, email: string, extra?: { exp?: number; iss?: string; aud?: string }) {
    void extra;
    void exportJWK;
    let builder = new SignJWT({ email })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(extra?.iss ?? ISSUER)
      .setAudience(extra?.aud ?? AUDIENCE)
      .setIssuedAt();
    if (extra?.exp !== undefined) {
      builder = builder.setExpirationTime(extra.exp);
    } else {
      builder = builder.setExpirationTime("1h");
    }
    return builder.sign(privateKey);
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

test("GET /v1/me without token returns 401", async () => {
  const { app } = await createTestApp();
  const response = await app.inject({ method: "GET", url: "/v1/me" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, "UNAUTHENTICATED");
  await app.close();
});

test("GET /v1/me bootstraps a stable app user without a workspace", async () => {
  const { app, token } = await createTestApp();
  const access = await token("auth-user-1", "Owner@example.com");
  const first = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(first.statusCode, 200);
  const firstBody = first.json();
  assert.equal(firstBody.data.bootstrap_state, "needs_workspace");
  assert.equal(firstBody.data.workspace, null);
  assert.equal(firstBody.data.user.display_email, "Owner@example.com");
  assert.equal(firstBody.data.entitlement.status, "none");
  const second = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(second.json().data.user.id, firstBody.data.user.id);
  await app.close();
});

test("expired or wrong-issuer tokens are 401", async () => {
  const { app, token } = await createTestApp();
  const expired = await token("auth-user-2", "a@example.com", { exp: Math.floor(Date.now() / 1000) - 60 });
  const badIssuer = await token("auth-user-2", "a@example.com", { iss: "http://evil.test/auth/v1" });
  const expiredRes = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${expired}` },
  });
  const issuerRes = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${badIssuer}` },
  });
  assert.equal(expiredRes.statusCode, 401);
  assert.equal(issuerRes.statusCode, 401);
  await app.close();
});

test("POST /v1/workspace requires auth and Idempotency-Key", async () => {
  const { app, token } = await createTestApp();
  const unauth = await app.inject({ method: "POST", url: "/v1/workspace", payload: workspaceBody() });
  assert.equal(unauth.statusCode, 401);
  const access = await token("auth-user-3", "a@example.com");
  const missingKey = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: { authorization: `Bearer ${access}` },
    payload: workspaceBody(),
  });
  assert.equal(missingKey.statusCode, 422);
  await app.close();
});

test("POST /v1/workspace creates workspace, membership, and allowances atomically", async () => {
  const { app, token } = await createTestApp();
  const access = await token("auth-user-4", "a@example.com");
  const key = "11111111-1111-4111-8111-111111111111";
  const created = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": key,
    },
    payload: workspaceBody(),
  });
  assert.equal(created.statusCode, 200);
  const body = created.json();
  assert.equal(body.data.workspace.business_name, "Oak Street Repair");
  assert.equal(body.data.workspace.currency, "USD");
  assert.equal(body.data.membership.role, "owner");
  assert.equal(body.data.allowances.free_jobs_consumed, 0);
  const me = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${access}` },
  });
  assert.equal(me.json().data.bootstrap_state, "ready");
  assert.equal(me.json().data.workspace.id, body.data.workspace.id);
  await app.close();
});

test("workspace replay and second create are rejected correctly", async () => {
  const { app, token } = await createTestApp();
  const access = await token("auth-user-5", "a@example.com");
  const key = "22222222-2222-4222-8222-222222222222";
  const first = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: { authorization: `Bearer ${access}`, "idempotency-key": key },
    payload: workspaceBody(),
  });
  const replay = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: { authorization: `Bearer ${access}`, "idempotency-key": key },
    payload: workspaceBody(),
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().data.workspace.id, first.json().data.workspace.id);
  const mismatch = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: { authorization: `Bearer ${access}`, "idempotency-key": key },
    payload: { ...workspaceBody(), business_name: "Other Name Co" },
  });
  assert.equal(mismatch.statusCode, 409);
  assert.equal(mismatch.json().error.code, "IDEMPOTENCY_MISMATCH");
  const second = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": "33333333-3333-4333-8333-333333333333",
    },
    payload: workspaceBody(),
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error.code, "WORKSPACE_EXISTS");
  await app.close();
});

test("client-supplied ownership ids cannot hijack another workspace", async () => {
  const { app, token } = await createTestApp();
  const userA = await token("auth-user-a", "a@example.com");
  const userB = await token("auth-user-b", "b@example.com");
  const created = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${userA}`,
      "idempotency-key": "44444444-4444-4444-8444-444444444444",
    },
    payload: workspaceBody(),
  });
  const aWorkspaceId = created.json().data.workspace.id;
  const hijack = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${userB}`,
      "idempotency-key": "55555555-5555-4555-8555-555555555555",
    },
    payload: {
      ...workspaceBody(),
      owner_user_id: created.json().data.workspace.id,
      workspace_id: aWorkspaceId,
      id: aWorkspaceId,
    },
  });
  assert.equal(hijack.statusCode, 422);
  const bMe = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${userB}` },
  });
  assert.equal(bMe.json().data.workspace, null);
  const aMe = await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${userA}` },
  });
  assert.equal(aMe.json().data.workspace.id, aWorkspaceId);
  assert.notEqual(aMe.json().data.user.id, bMe.json().data.user.id);
  await app.close();
});

test("suspended owners cannot create a workspace", async () => {
  const { app, token, harness } = await createTestApp();
  const access = await token("auth-user-suspended", "s@example.com");
  await app.inject({
    method: "GET",
    url: "/v1/me",
    headers: { authorization: `Bearer ${access}` },
  });
  harness.setUserStatus("auth-user-suspended", "suspended");
  const response = await app.inject({
    method: "POST",
    url: "/v1/workspace",
    headers: {
      authorization: `Bearer ${access}`,
      "idempotency-key": "66666666-6666-4666-8666-666666666666",
    },
    payload: workspaceBody(),
  });
  assert.equal(response.statusCode, 403);
  assert.equal(response.json().error.code, "ACCOUNT_SUSPENDED");
  await app.close();
});
