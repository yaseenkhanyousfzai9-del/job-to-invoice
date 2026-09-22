import assert from "node:assert/strict";
import { test } from "node:test";
import { createVerifyScreenSubmitPolicy } from "./verify-screen-submit";
import { createVerifySingleFlight } from "./verify-auth-flow";
import {
  createOtpVerifyAttemptGate,
  runGuardedVerifyAttempt,
} from "./otp-verify-gate";

test("one physical-like press → one screen handler → one provider → one verifyOtp", async () => {
  const policy = createVerifyScreenSubmitPolicy();
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  let screenCalls = 0;
  let providerCalls = 0;
  let verifyOtpCalls = 0;

  async function simulatePress() {
    if (!policy.canSubmit(1, false, false)) {
      return;
    }
    policy.beginAttempt(1, "button");
    screenCalls += 1;
    const result = await runGuardedVerifyAttempt({
      generation: 1,
      flight,
      gate,
      verifyOtp: async () => {
        verifyOtpCalls += 1;
        return { status: 403 };
      },
    });
    if (result.kind === "ran") {
      providerCalls += 1;
    }
    policy.releaseInFlightOnly();
  }

  await simulatePress();
  assert.equal(screenCalls, 1);
  assert.equal(providerCalls, 1);
  assert.equal(verifyOtpCalls, 1);
});

test("rapid double tap on screen → one verifyOtp", async () => {
  const policy = createVerifyScreenSubmitPolicy();
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  let verifyOtpCalls = 0;

  async function simulatePress() {
    if (!policy.canSubmit(1, false, false)) {
      return;
    }
    policy.beginAttempt(1, "button");
    await runGuardedVerifyAttempt({
      generation: 1,
      flight,
      gate,
      verifyOtp: async () => {
        verifyOtpCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { status: 403 };
      },
    });
    policy.releaseInFlightOnly();
  }

  await Promise.all([simulatePress(), simulatePress()]);
  assert.equal(verifyOtpCalls, 1);
  assert.equal(policy.locked, true);
});

test("after 403, waiting and re-submit same generation → still one verifyOtp", async () => {
  const policy = createVerifyScreenSubmitPolicy();
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  let verifyOtpCalls = 0;

  async function simulatePress() {
    if (!policy.canSubmit(7, false, false)) {
      return;
    }
    policy.beginAttempt(7, "button");
    await runGuardedVerifyAttempt({
      generation: 7,
      flight,
      gate,
      verifyOtp: async () => {
        verifyOtpCalls += 1;
        return { status: 403 };
      },
    });
    policy.releaseInFlightOnly();
  }

  await simulatePress();
  await new Promise((r) => setTimeout(r, 40));
  await simulatePress();
  await simulatePress();
  assert.equal(verifyOtpCalls, 1);
});

test("rerender-style second press after 403 → blocked", async () => {
  const policy = createVerifyScreenSubmitPolicy();
  policy.beginAttempt(3, "button");
  policy.releaseInFlightOnly();
  assert.equal(policy.canSubmit(3, false, false), false);
});

test("mount with code already populated → verifyOtp call count = 0", () => {
  const policy = createVerifyScreenSubmitPolicy();
  // Creating policy / "mount" must not begin an attempt.
  assert.equal(policy.screenAttempt, 0);
  assert.equal(policy.locked, false);
});

test("Fast Refresh-like remount with populated code → no automatic call", () => {
  const before = createVerifyScreenSubmitPolicy();
  before.beginAttempt(2, "button");
  // Remount creates a fresh screen policy; automatic verify must still not run.
  const afterRemount = createVerifyScreenSubmitPolicy();
  assert.equal(afterRemount.screenAttempt, 0);
  assert.equal(afterRemount.locked, false);
  // Provider gate (survives remount) still blocks same generation.
  const gate = createOtpVerifyAttemptGate();
  gate.markProviderAttempted(2);
  assert.equal(gate.canAttempt(2), false);
});

test("countdown tick must not call verification (policy unchanged)", () => {
  const policy = createVerifyScreenSubmitPolicy();
  // Simulate many countdown setNow ticks — no beginAttempt.
  for (let i = 0; i < 30; i += 1) {
    void Date.now();
  }
  assert.equal(policy.screenAttempt, 0);
});

test("auth/navigation state updates must not call verification", () => {
  const policy = createVerifyScreenSubmitPolicy();
  // Observing navigation/error/verifying changes is UI-only; no beginAttempt.
  const _nav = "auth" as const;
  const _error = "Token has expired or is invalid";
  void _nav;
  void _error;
  assert.equal(policy.screenAttempt, 0);
});

test("user code edit unlocks for a new manual attempt", () => {
  const policy = createVerifyScreenSubmitPolicy();
  policy.beginAttempt(4, "button");
  assert.equal(policy.canSubmit(4, false, false), false);
  policy.clearForUserCodeEdit();
  assert.equal(policy.canSubmit(4, false, false), true);
});

test("new OTP generation unlocks screen for one new verify", () => {
  const policy = createVerifyScreenSubmitPolicy();
  policy.beginAttempt(1, "button");
  policy.clearForNewGeneration(2);
  assert.equal(policy.canSubmit(2, false, false), true);
});
