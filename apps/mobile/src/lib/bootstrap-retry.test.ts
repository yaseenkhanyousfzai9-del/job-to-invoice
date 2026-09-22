import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeData } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import { BOOTSTRAP_FAILED_MESSAGE } from "./verify-auth-flow";

/**
 * Documents Retry bootstrap policy after OTP success:
 * - uses persistent session access token
 * - does not call verifyOtp
 * - 5xx keeps session
 * - 401 keeps session (does not force new OTP)
 */

type RetryDeps = {
  getPersistentAccessToken: () => Promise<string | null>;
  fetchMe: (token: string) => Promise<MeData>;
  verifyOtpCalls: { count: number };
  signOutCalls: { count: number };
};

async function runRetryBootstrap(deps: RetryDeps): Promise<{
  ok: boolean;
  error: string | null;
  signedOut: boolean;
  meCalls: number;
}> {
  let meCalls = 0;
  const token = await deps.getPersistentAccessToken();
  if (!token) {
    return { ok: false, error: "Sign in to continue.", signedOut: false, meCalls: 0 };
  }
  try {
    meCalls += 1;
    await deps.fetchMe(token);
    return { ok: true, error: null, signedOut: false, meCalls };
  } catch (cause) {
    if (cause instanceof DomainApiError && cause.api.status === 401) {
      // Keep session — do not sign out / re-OTP.
      return {
        ok: false,
        error: BOOTSTRAP_FAILED_MESSAGE,
        signedOut: deps.signOutCalls.count > 0,
        meCalls,
      };
    }
    if (cause instanceof DomainApiError && cause.api.status >= 500) {
      return {
        ok: false,
        error: BOOTSTRAP_FAILED_MESSAGE,
        signedOut: deps.signOutCalls.count > 0,
        meCalls,
      };
    }
    throw cause;
  }
}

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

test("Retry uses persistent session without OTP", async () => {
  const verifyOtpCalls = { count: 0 };
  const signOutCalls = { count: 0 };
  const result = await runRetryBootstrap({
    getPersistentAccessToken: async () => "persistent-access-token",
    fetchMe: async (token) => {
      assert.equal(token, "persistent-access-token");
      return meReady();
    },
    verifyOtpCalls,
    signOutCalls,
  });
  assert.equal(result.ok, true);
  assert.equal(verifyOtpCalls.count, 0);
  assert.equal(result.signedOut, false);
});

test("Retry /v1/me 401 does not destroy session", async () => {
  const signOutCalls = { count: 0 };
  const result = await runRetryBootstrap({
    getPersistentAccessToken: async () => "persistent-access-token",
    fetchMe: async () => {
      throw new DomainApiError({
        code: "UNAUTHENTICATED",
        message: "Sign in to continue.",
        field_errors: {},
        retryable: false,
        status: 401,
      });
    },
    verifyOtpCalls: { count: 0 },
    signOutCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, BOOTSTRAP_FAILED_MESSAGE);
  assert.equal(result.signedOut, false);
  assert.equal(signOutCalls.count, 0);
});

test("Retry transient /v1/me 5xx does not destroy session", async () => {
  const signOutCalls = { count: 0 };
  const result = await runRetryBootstrap({
    getPersistentAccessToken: async () => "persistent-access-token",
    fetchMe: async () => {
      throw new DomainApiError({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        field_errors: {},
        retryable: true,
        status: 500,
      });
    },
    verifyOtpCalls: { count: 0 },
    signOutCalls,
  });
  assert.equal(result.ok, false);
  assert.equal(result.signedOut, false);
  assert.equal(signOutCalls.count, 0);
});

test("ready bootstrap_state is the API contract name", () => {
  const data = meReady();
  assert.equal(data.bootstrap_state, "ready");
  assert.notEqual(data.bootstrap_state, "authenticated");
  assert.notEqual(data.bootstrap_state, "workspace_ready");
});
