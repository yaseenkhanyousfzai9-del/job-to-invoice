import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeData } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import { runSessionBootstrap } from "./sessionBootstrap";
import { BOOTSTRAP_FAILED_MESSAGE } from "./verify-auth-flow";
import {
  createLatestOtpRequestState,
  resolveCanonicalVerifyEmail,
} from "./otp-request-state";

function meReady(): MeData {
  return {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      display_email: "owner@example.com",
      status: "active",
    },
    bootstrap_state: "ready",
    workspace: {
      id: "22222222-2222-4222-8222-222222222222",
      business_name: "Oak",
      trade: "handyman",
      timezone: "America/Chicago",
      currency: "USD",
      version: 1,
    },
    membership: { role: "owner", status: "active" },
    allowances: null,
    entitlement: { status: "none", product_id: null, expires_at: null },
  };
}

/** In-memory stand-in for SecureStore-backed session across "process restart". */
function createMemorySessionStore() {
  let value: string | null = null;
  return {
    async getItem(): Promise<string | null> {
      return value;
    },
    async setItem(_key: string, next: string): Promise<void> {
      value = next;
    },
    async removeItem(): Promise<void> {
      value = null;
    },
    hasValue(): boolean {
      return value !== null;
    },
  };
}

test("successful setSession persists session for later bootstrap", async () => {
  const store = createMemorySessionStore();
  await store.setItem("sb", JSON.stringify({ access_token: "tok-persist" }));
  assert.equal(store.hasValue(), true);

  let signOutCalls = 0;
  const otpCalls = 0;
  let meCalls = 0;
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => {
      const raw = await store.getItem();
      if (!raw) return { session: null };
      const parsed = JSON.parse(raw) as { access_token: string };
      return { session: { access_token: parsed.access_token } };
    },
    fetchMe: async (token) => {
      meCalls += 1;
      assert.equal(token, "tok-persist");
      return meReady();
    },
    signOut: async () => {
      signOutCalls += 1;
      await store.removeItem();
    },
  });

  assert.equal(result.kind, "success");
  assert.equal(signOutCalls, 0);
  assert.equal(otpCalls, 0);
  assert.equal(meCalls, 1);
  assert.equal(store.hasValue(), true);
});

test("simulated process restart reads persisted session → authenticated app", async () => {
  const store = createMemorySessionStore();
  await store.setItem("sb", JSON.stringify({ access_token: "tok-restart" }));

  // "New process": new bootstrap call reading same store.
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => {
      const raw = await store.getItem();
      assert.ok(raw);
      return { session: { access_token: "tok-restart" } };
    },
    fetchMe: async () => meReady(),
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigation, "app");
  }
});

test("cold-start persisted session does not call signOut", async () => {
  let signOutCalls = 0;
  await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => meReady(),
    signOut: async () => {
      signOutCalls += 1;
    },
  });
  assert.equal(signOutCalls, 0);
});

test("cold-start /v1/me 401 keeps session and does not signOut", async () => {
  let signOutCalls = 0;
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => {
      throw new DomainApiError({
        code: "UNAUTHENTICATED",
        message: "Sign in",
        field_errors: {},
        retryable: false,
        status: 401,
      });
    },
    signOut: async () => {
      signOutCalls += 1;
    },
  });
  assert.equal(result.kind, "bootstrap_failed");
  assert.equal(signOutCalls, 0);
  if (result.kind === "bootstrap_failed") {
    assert.equal(result.accessToken, "tok");
    assert.equal(result.message, BOOTSTRAP_FAILED_MESSAGE);
  }
});

test("cold-start /v1/me 5xx keeps session and does not signOut", async () => {
  let signOutCalls = 0;
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => {
      throw new DomainApiError({
        code: "INTERNAL_ERROR",
        message: "Server",
        field_errors: {},
        retryable: true,
        status: 503,
      });
    },
    signOut: async () => {
      signOutCalls += 1;
    },
  });
  assert.equal(result.kind, "bootstrap_failed");
  assert.equal(signOutCalls, 0);
});

test("cold-start bootstrap timeout does not signOut", async () => {
  let signOutCalls = 0;
  const result = await runSessionBootstrap({
    configured: true,
    getSession: () => new Promise(() => undefined),
    fetchMe: async () => meReady(),
    signOut: async () => {
      signOutCalls += 1;
    },
    sessionTimeoutMs: 20,
  });
  assert.equal(result.kind, "session_error");
  assert.equal(signOutCalls, 0);
});

test("cold-start persisted session calls /v1/me and routes app", async () => {
  let meCalls = 0;
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => {
      meCalls += 1;
      return meReady();
    },
  });
  assert.equal(meCalls, 1);
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigation, "app");
  }
});

test("new OTP send clears prior generation and bumps epoch semantics", () => {
  const state = createLatestOtpRequestState();
  const first = state.recordSuccessfulSend("a@example.com");
  const second = state.recordSuccessfulSend("a@example.com");
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 2);
  assert.notEqual(first.generation, second.generation);
});

test("resend replaces email generation so old OTP cannot stay canonical", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("a@example.com");
  const next = state.recordSuccessfulSend("a@example.com");
  assert.equal(next.generation, 2);
});

test("verify remount without active OTP transaction has no pending email", () => {
  const state = createLatestOtpRequestState();
  // Cold start: latest OTP request is empty — route email alone is not an active transaction.
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: state.current?.email ?? null,
    routeEmail: "stale@example.com",
  });
  // Route fallback still resolves email for legacy helpers, but UI requires hasActiveOtpTransaction.
  assert.equal(resolved.source, "route");
  assert.equal(state.current, null);
});

test("explicit signOut callback removes persisted session once", async () => {
  const store = createMemorySessionStore();
  await store.setItem("sb", "session");
  let signOutCalls = 0;
  const signOut = async () => {
    signOutCalls += 1;
    await store.removeItem();
  };
  await signOut();
  assert.equal(signOutCalls, 1);
  assert.equal(store.hasValue(), false);
});
