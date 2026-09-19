import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeData } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import {
  BOOTSTRAP_FAILED_MESSAGE,
  createVerifySingleFlight,
  runVerifyAuthFlow,
  type VerifyOtpFn,
} from "./verify-auth-flow";

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

function okVerify(): VerifyOtpFn {
  return async () => ({
    data: { session: { access_token: "access-token" } },
    error: null,
  });
}

test("single-flight guard allows only one begin at a time", () => {
  const guard = createVerifySingleFlight();
  assert.equal(guard.tryBegin(), true);
  assert.equal(guard.tryBegin(), false);
  guard.end();
  assert.equal(guard.tryBegin(), true);
  guard.end();
});

test("successful verify calls verifyOtp once and does not recall it during bootstrap", async () => {
  let verifyCalls = 0;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: async (input) => {
      verifyCalls += 1;
      assert.equal(input.type, "email");
      assert.equal(input.token, "123456");
      return {
        data: { session: { access_token: "access-token" } },
        error: null,
      };
    },
    fetchMe: async () => me("ready"),
  });
  assert.equal(verifyCalls, 1);
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigationTarget, "app");
  }
});

test("rapid double begin still results in one verifyOtp when second is rejected by guard", async () => {
  const guard = createVerifySingleFlight();
  let verifyCalls = 0;
  const verifyOtp: VerifyOtpFn = async () => {
    verifyCalls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return { data: { session: { access_token: "access-token" } }, error: null };
  };

  async function attempt() {
    if (!guard.tryBegin()) {
      return { kind: "busy" as const };
    }
    try {
      return await runVerifyAuthFlow({
        email: "owner@example.com",
        code: "123456",
        verifyOtp,
        fetchMe: async () => me("needs_workspace"),
      });
    } finally {
      guard.end();
    }
  }

  const firstPromise = attempt();
  const second = await attempt();
  const first = await firstPromise;
  assert.equal(second.kind, "busy");
  assert.equal(first.kind, "success");
  assert.equal(verifyCalls, 1);
});

test("verify success + /v1/me failure shows bootstrap error and does not remap to OTP", async () => {
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: okVerify(),
    fetchMe: async () => {
      throw new DomainApiError({
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        field_errors: {},
        retryable: true,
        status: 500,
      });
    },
  });
  assert.equal(result.kind, "bootstrap_failed");
  if (result.kind === "bootstrap_failed") {
    assert.equal(result.message, BOOTSTRAP_FAILED_MESSAGE);
    assert.equal(result.accessToken, "access-token");
    assert.doesNotMatch(result.message.toLowerCase(), /incorrect or expired/);
  }
});

test("verify success + needs_workspace routes to setup", async () => {
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: okVerify(),
    fetchMe: async () => me("needs_workspace"),
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigationTarget, "setup");
  }
});

test("verify success + ready routes to owner shell", async () => {
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: okVerify(),
    fetchMe: async () => me("ready"),
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigationTarget, "app");
  }
});

test("actual verifyOtp rejection shows incorrect/expired message", async () => {
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "000000",
    verifyOtp: async () => ({
      data: { session: null },
      error: {
        name: "AuthApiError",
        status: 403,
        code: "otp_expired",
        message: "Token has expired or is invalid",
      },
    }),
    fetchMe: async () => {
      throw new Error("fetchMe must not run");
    },
  });
  assert.equal(result.kind, "otp_invalid");
  if (result.kind === "otp_invalid") {
    assert.equal(result.message, "That code is incorrect or expired.");
  }
});
