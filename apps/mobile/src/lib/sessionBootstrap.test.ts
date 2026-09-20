import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeData } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import { runSessionBootstrap, withTimeout } from "./sessionBootstrap";
import { BOOTSTRAP_FAILED_MESSAGE } from "./verify-auth-flow";

function me(bootstrap: "needs_workspace" | "ready"): MeData {
  return {
    user: {
      id: "11111111-1111-4111-8111-111111111111",
      display_email: "owner@example.com",
      status: "active",
    },
    bootstrap_state: bootstrap,
    workspace:
      bootstrap === "ready"
        ? {
            id: "22222222-2222-4222-8222-222222222222",
            business_name: "Oak",
            trade: "handyman",
            timezone: "America/Chicago",
            currency: "USD",
            version: 1,
          }
        : null,
    membership: bootstrap === "ready" ? { role: "owner", status: "active" } : null,
    allowances: null,
    entitlement: { status: "none", product_id: null, expires_at: null },
  };
}

test("withTimeout rejects after deadline", async () => {
  await assert.rejects(
    () => withTimeout(new Promise(() => undefined), 20, "SESSION_RESTORE_TIMEOUT"),
    /SESSION_RESTORE_TIMEOUT/,
  );
});

test("no session routes to welcome outcome", async () => {
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: null }),
    fetchMe: async () => me("ready"),
    signOut: async () => undefined,
  });
  assert.equal(result.kind, "no_session");
});

test("valid session + workspace routes to app", async () => {
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => me("ready"),
    signOut: async () => undefined,
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigation, "app");
  }
});

test("valid session + no workspace routes to setup", async () => {
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => me("needs_workspace"),
    signOut: async () => undefined,
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigation, "setup");
  }
});

test("/v1/me failure is bootstrap_failed and does not hang", async () => {
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => {
      throw new DomainApiError({
        code: "NETWORK",
        message: "Network problem.",
        field_errors: {},
        retryable: true,
        status: 0,
      });
    },
    signOut: async () => undefined,
  });
  assert.equal(result.kind, "bootstrap_failed");
  if (result.kind === "bootstrap_failed") {
    assert.equal(result.message, BOOTSTRAP_FAILED_MESSAGE);
    assert.equal(result.accessToken, "tok");
  }
});

test("session restore timeout becomes recoverable session_error", async () => {
  const result = await runSessionBootstrap({
    configured: true,
    getSession: () => new Promise(() => undefined),
    fetchMe: async () => me("ready"),
    signOut: async () => undefined,
    sessionTimeoutMs: 30,
  });
  assert.equal(result.kind, "session_error");
});

test("/v1/me 401 keeps session and does not sign out", async () => {
  let signOutCalls = 0;
  const result = await runSessionBootstrap({
    configured: true,
    getSession: async () => ({ session: { access_token: "tok" } }),
    fetchMe: async () => {
      throw new DomainApiError({
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
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
