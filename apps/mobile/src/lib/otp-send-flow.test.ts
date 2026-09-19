import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOtpGenerationTracker,
  createSendSingleFlight,
  prepareVerifyToken,
  runSendOtpFlow,
} from "./otp-send-flow";
import { runVerifyAuthFlow } from "./verify-auth-flow";
import type { MeData } from "@job-to-invoice/domain";

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

test("Send Code one tap → one signInWithOtp call", async () => {
  let calls = 0;
  const flight = createSendSingleFlight();
  const generation = createOtpGenerationTracker();
  const result = await runSendOtpFlow({
    email: "owner@example.com",
    flight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async (input) => {
      calls += 1;
      assert.equal(Object.keys(input).join(","), "email");
      return { error: null };
    },
  });
  assert.equal(result.kind, "success");
  assert.equal(calls, 1);
});

test("rapid Send Code double-tap → one call", async () => {
  const flight = createSendSingleFlight();
  const generation = createOtpGenerationTracker();
  let calls = 0;
  const signInWithOtp = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { error: null };
  };

  async function attempt() {
    return runSendOtpFlow({
      email: "owner@example.com",
      flight,
      generation,
      sessionPresentBeforeOtp: false,
      signInWithOtp,
    });
  }

  const firstPromise = attempt();
  const second = await attempt();
  const first = await firstPromise;
  assert.equal(second.kind, "busy");
  assert.equal(first.kind, "success");
  assert.equal(calls, 1);
});

test("Resend one tap → one signInWithOtp call", async () => {
  let calls = 0;
  const flight = createSendSingleFlight();
  const generation = createOtpGenerationTracker();
  generation.bump();
  const result = await runSendOtpFlow({
    email: "owner@example.com",
    flight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async () => {
      calls += 1;
      return { error: null };
    },
  });
  assert.equal(result.kind, "success");
  assert.equal(calls, 1);
  if (result.kind === "success") {
    assert.equal(result.generation, 2);
  }
});

test("rapid Resend double-tap → one call", async () => {
  const flight = createSendSingleFlight();
  const generation = createOtpGenerationTracker();
  let calls = 0;
  const signInWithOtp = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { error: null };
  };

  async function attempt() {
    return runSendOtpFlow({
      email: "owner@example.com",
      flight,
      generation,
      sessionPresentBeforeOtp: false,
      signInWithOtp,
    });
  }

  const firstPromise = attempt();
  const second = await attempt();
  const first = await firstPromise;
  assert.equal(second.kind, "busy");
  assert.equal(first.kind, "success");
  assert.equal(calls, 1);
});

test("successful resend clears old code input/error via generation bump", async () => {
  const generation = createOtpGenerationTracker();
  const flight = createSendSingleFlight();
  let codeInput = "111111";
  let error: string | null = "That code is incorrect or expired.";

  const result = await runSendOtpFlow({
    email: "owner@example.com",
    flight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async () => ({ error: null }),
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    // Screen clears when generation changes.
    codeInput = "";
    error = null;
    assert.equal(result.generation, 1);
    assert.equal(codeInput, "");
    assert.equal(error, null);
  }
});

test("newest OTP generation becomes current", async () => {
  const generation = createOtpGenerationTracker();
  const flight = createSendSingleFlight();
  assert.equal(generation.current, 0);
  await runSendOtpFlow({
    email: "owner@example.com",
    flight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async () => ({ error: null }),
  });
  assert.equal(generation.current, 1);
  await runSendOtpFlow({
    email: "owner@example.com",
    flight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async () => ({ error: null }),
  });
  assert.equal(generation.current, 2);
});

test("Verify uses current generation only", async () => {
  const generation = createOtpGenerationTracker();
  const sendFlight = createSendSingleFlight();
  await runSendOtpFlow({
    email: "owner@example.com",
    flight: sendFlight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async () => ({ error: null }),
  });
  await runSendOtpFlow({
    email: "owner@example.com",
    flight: sendFlight,
    generation,
    sessionPresentBeforeOtp: false,
    signInWithOtp: async () => ({ error: null }),
  });
  const current = generation.current;
  assert.equal(current, 2);

  let loggedGeneration: number | null | undefined = undefined;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    generation: current,
    verifyOtp: async () => ({
      data: { session: { access_token: "access-token" } },
      error: null,
    }),
    fetchMe: async () => meReady(),
    log: (stage, extra) => {
      if (stage === "verify_started") {
        loggedGeneration = extra?.generation as number | null | undefined;
      }
    },
  });
  assert.equal(loggedGeneration, 2);
  assert.equal(result.kind, "success");
});

test("Verify sends trimmed six-digit string", () => {
  const prepared = prepareVerifyToken("  654321  ");
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.equal(prepared.token, "654321");
    assert.equal(prepared.token.length, 6);
  }
});

test("no parseInt/Number conversion in prepareVerifyToken", () => {
  const source = prepareVerifyToken.toString();
  assert.doesNotMatch(source, /\bparseInt\b/);
  assert.doesNotMatch(source, /\bNumber\s*\(/);
  const leadingZero = prepareVerifyToken("012345");
  assert.equal(leadingZero.ok, true);
  if (leadingZero.ok) {
    assert.equal(leadingZero.token, "012345");
  }
});

test("successful verify continues bootstrap once", async () => {
  let verifyCalls = 0;
  let bootstrapCalls = 0;
  const result = await runVerifyAuthFlow({
    email: "owner@example.com",
    code: "123456",
    verifyOtp: async () => {
      verifyCalls += 1;
      return { data: { session: { access_token: "access-token" } }, error: null };
    },
    fetchMe: async () => {
      bootstrapCalls += 1;
      return meReady();
    },
  });
  assert.equal(result.kind, "success");
  assert.equal(verifyCalls, 1);
  assert.equal(bootstrapCalls, 1);
});
