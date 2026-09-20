import assert from "node:assert/strict";
import { test } from "node:test";
import type { MeData } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import {
  BOOTSTRAP_FAILED_MESSAGE,
  SESSION_HANDOFF_FAILED_MESSAGE,
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
    data: { session: { access_token: "access-token", refresh_token: "refresh-token" } },
    error: null,
  });
}

function okSetSession() {
  return async () => ({ error: null });
}

test("single-flight guard allows only one begin at a time", () => {
  const guard = createVerifySingleFlight();
  assert.equal(guard.tryBegin(), true);
  assert.equal(guard.tryBegin(), false);
  guard.end();
  assert.equal(guard.tryBegin(), true);
  guard.end();
});

test("verify request shape is latest email + six-digit token + type email", async () => {
  let seen: { email: string; token: string; type: string } | null = null;
  await runVerifyAuthFlow({
    email: "latest@example.com",
    code: "654321",
    verifyOtp: async (input) => {
      seen = input;
      return {
        data: { session: { access_token: "a", refresh_token: "r" } },
        error: null,
      };
    },
    setSession: okSetSession(),
    fetchMe: async () => me("ready"),
  });
  assert.deepEqual(seen, {
    email: "latest@example.com",
    token: "654321",
    type: "email",
  });
});

test("verify success hands session to persistent setSession", async () => {
  let handoff: { access_token: string; refresh_token: string } | null = null;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: okVerify(),
    setSession: async (session) => {
      handoff = session;
      return { error: null };
    },
    fetchMe: async () => me("ready"),
  });
  assert.equal(result.kind, "success");
  assert.deepEqual(handoff, {
    access_token: "access-token",
    refresh_token: "refresh-token",
  });
});

test("setSession success → /v1/me runs", async () => {
  let meCalls = 0;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: okVerify(),
    setSession: okSetSession(),
    fetchMe: async () => {
      meCalls += 1;
      return me("ready");
    },
  });
  assert.equal(result.kind, "success");
  assert.equal(meCalls, 1);
});

test("setSession failure → /v1/me does NOT run", async () => {
  let meCalls = 0;
  let verifyCalls = 0;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: async () => {
      verifyCalls += 1;
      return {
        data: { session: { access_token: "a", refresh_token: "r" } },
        error: null,
      };
    },
    setSession: async () => ({ error: { message: "storage failed" } }),
    fetchMe: async () => {
      meCalls += 1;
      return me("ready");
    },
  });
  assert.equal(result.kind, "session_handoff_failed");
  if (result.kind === "session_handoff_failed") {
    assert.equal(result.message, SESSION_HANDOFF_FAILED_MESSAGE);
  }
  assert.equal(meCalls, 0);
  assert.equal(verifyCalls, 1);
});

test("/v1/me failure does NOT call verifyOtp again", async () => {
  let verifyCalls = 0;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: async () => {
      verifyCalls += 1;
      return {
        data: { session: { access_token: "access-token", refresh_token: "refresh-token" } },
        error: null,
      };
    },
    setSession: okSetSession(),
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
  assert.equal(verifyCalls, 1);
  if (result.kind === "bootstrap_failed") {
    assert.equal(result.message, BOOTSTRAP_FAILED_MESSAGE);
  }
});

test("persistent getSession works after successful handoff", async () => {
  let getSessionCalls = 0;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: okVerify(),
    setSession: okSetSession(),
    getSession: async () => {
      getSessionCalls += 1;
      return { session: { access_token: "access-token" } };
    },
    fetchMe: async () => me("needs_workspace"),
  });
  assert.equal(result.kind, "success");
  assert.equal(getSessionCalls, 1);
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
        data: { session: { access_token: "access-token", refresh_token: "refresh-token" } },
        error: null,
      };
    },
    setSession: okSetSession(),
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
    return {
      data: { session: { access_token: "access-token", refresh_token: "refresh-token" } },
      error: null,
    };
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
        setSession: okSetSession(),
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
    setSession: okSetSession(),
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
    setSession: okSetSession(),
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
    setSession: okSetSession(),
    fetchMe: async () => me("ready"),
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.navigationTarget, "app");
  }
});

test("actual verifyOtp rejection shows incorrect/expired message", async () => {
  let setSessionCalls = 0;
  let meCalls = 0;
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
    setSession: async () => {
      setSessionCalls += 1;
      return { error: null };
    },
    fetchMe: async () => {
      meCalls += 1;
      throw new Error("fetchMe must not run");
    },
  });
  assert.equal(result.kind, "otp_invalid");
  if (result.kind === "otp_invalid") {
    assert.equal(result.message, "That code is incorrect or expired.");
  }
  assert.equal(setSessionCalls, 0);
  assert.equal(meCalls, 0);
});

test("403 → no automatic retry of verifyOtp", async () => {
  let verifyCalls = 0;
  await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "111111",
    verifyOtp: async () => {
      verifyCalls += 1;
      return {
        data: { session: null },
        error: { status: 403, message: "Token has expired or is invalid" },
      };
    },
    setSession: okSetSession(),
    fetchMe: async () => me("ready"),
  });
  assert.equal(verifyCalls, 1);
});
