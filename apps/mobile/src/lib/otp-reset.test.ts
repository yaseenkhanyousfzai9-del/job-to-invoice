import assert from "node:assert/strict";
import { test } from "node:test";
import { createLatestOtpRequestState } from "./otp-request-state";
import { createOtpVerifyAttemptGate } from "./otp-verify-gate";
import { createVerifyScreenSubmitPolicy } from "./verify-screen-submit";

/**
 * OTP input must clear on new generation. Screen state is React-local;
 * these tests lock the generation/gate contracts the Verify screen depends on.
 */

test("new OTP generation clears prior verify attempt gate", () => {
  const gate = createOtpVerifyAttemptGate();
  assert.equal(gate.canAttempt(1), true);
  gate.markProviderAttempted(1);
  assert.equal(gate.canAttempt(1), false);
  gate.clearForNewGeneration(2);
  assert.equal(gate.canAttempt(2), true);
});

test("new OTP generation clears verify screen submit lock", () => {
  const policy = createVerifyScreenSubmitPolicy();
  assert.equal(policy.canSubmit(1, false, false), true);
  policy.beginAttempt(1, "button");
  assert.equal(policy.canSubmit(1, false, false), false);
  policy.clearForNewGeneration(2);
  assert.equal(policy.canSubmit(2, false, false), true);
});

test("OTP values are not stored in latest-request state (email+generation only)", () => {
  const state = createLatestOtpRequestState();
  const recorded = state.recordSuccessfulSend("owner@example.com");
  assert.equal(recorded.email, "owner@example.com");
  assert.equal(recorded.generation, 1);
  assert.equal(Object.hasOwn(recorded, "code"), false);
  assert.equal(Object.hasOwn(recorded, "token"), false);
});

test("clearing OTP request state leaves no restoreable transaction", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("owner@example.com");
  state.clear();
  assert.equal(state.current, null);
});

test("old generation cannot be submitted after new send", () => {
  const gate = createOtpVerifyAttemptGate();
  const policy = createVerifyScreenSubmitPolicy();
  let currentGeneration = 1;
  gate.clearForNewGeneration(currentGeneration);
  policy.clearForNewGeneration(currentGeneration);
  gate.markProviderAttempted(currentGeneration);
  policy.beginAttempt(currentGeneration, "button");
  assert.equal(policy.canSubmit(currentGeneration, false, false), false);

  // New send — only the new generation is used by Verify UI.
  currentGeneration = 2;
  gate.clearForNewGeneration(currentGeneration);
  policy.clearForNewGeneration(currentGeneration);
  assert.equal(gate.canAttempt(currentGeneration), true);
  assert.equal(policy.canSubmit(currentGeneration, false, false), true);
});
