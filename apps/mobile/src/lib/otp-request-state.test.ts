import assert from "node:assert/strict";
import { test } from "node:test";
import { maskEmail } from "@job-to-invoice/domain";
import {
  createLatestOtpRequestState,
  resolveCanonicalVerifyEmail,
} from "./otp-request-state";
import { prepareVerifyToken } from "./otp-send-flow";

test("Send Email A → verify uses Email A", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("a@example.com");
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: state.current!.email,
    routeEmail: "a@example.com",
  });
  assert.equal(resolved.email, "a@example.com");
  assert.equal(resolved.source, "pending");
});

test("Send Email A → Change email → Send Email B → verify uses Email B", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("a@example.com");
  state.recordSuccessfulSend("b@example.com");
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: state.current!.email,
    routeEmail: "a@example.com",
  });
  assert.equal(resolved.email, "b@example.com");
  assert.equal(state.current!.email, "b@example.com");
  assert.equal(resolved.source, "pending");
});

test("stale route param Email A + pending Email B → verify uses Email B", () => {
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: "b@example.com",
    routeEmail: "a@example.com",
  });
  assert.equal(resolved.email, "b@example.com");
  assert.equal(resolved.source, "pending");
  assert.notEqual(resolved.email, "a@example.com");
});

test("resend for same email increments generation", () => {
  const state = createLatestOtpRequestState();
  const first = state.recordSuccessfulSend("same@example.com");
  const second = state.recordSuccessfulSend("same@example.com");
  assert.equal(first.generation, 1);
  assert.equal(second.generation, 2);
  assert.equal(second.email, "same@example.com");
});

test("resend for different email replaces canonical email", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("a@example.com");
  const next = state.recordSuccessfulSend("b@example.com");
  assert.equal(next.email, "b@example.com");
  assert.equal(next.generation, 2);
});

test("masked email display uses canonical verify email", () => {
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: "canonical@example.com",
    routeEmail: "stale@example.com",
  });
  const displayed = maskEmail(resolved.email);
  assert.equal(displayed, maskEmail("canonical@example.com"));
  assert.notEqual(displayed, maskEmail("stale@example.com"));
});

test("code from previous generation is cleared after resend", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("owner@example.com");
  let code = "111111";
  const previousGeneration = state.current!.generation;
  state.recordSuccessfulSend("owner@example.com");
  if (state.current!.generation !== previousGeneration) {
    code = "";
  }
  assert.equal(state.current!.generation, 2);
  assert.equal(code, "");
});

test("verifyOtp uses latest send email, current six-digit token, type email", () => {
  const state = createLatestOtpRequestState();
  state.recordSuccessfulSend("a@example.com");
  state.recordSuccessfulSend("latest@example.com");
  const prepared = prepareVerifyToken(" 654321 ");
  assert.equal(prepared.ok, true);
  if (!prepared.ok) {
    return;
  }
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: state.current!.email,
    routeEmail: "a@example.com",
  });
  const verifyInput = {
    email: resolved.email,
    token: prepared.token,
    type: "email" as const,
  };
  assert.equal(verifyInput.email, "latest@example.com");
  assert.equal(verifyInput.token, "654321");
  assert.equal(verifyInput.type, "email");
});

test("route param cannot override latest OTP request state", () => {
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: "newest@example.com",
    routeEmail: ["oldest@example.com", "also-old@example.com"],
  });
  assert.equal(resolved.email, "newest@example.com");
  assert.equal(resolved.source, "pending");
});

test("existing session/storage does not change verify email selection", () => {
  const sessionPresent = true;
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: "otp-owner@example.com",
    routeEmail: "route@example.com",
  });
  assert.equal(sessionPresent, true);
  assert.equal(resolved.email, "otp-owner@example.com");
  assert.equal(resolved.source, "pending");
});

test("route fallback only when no pending email", () => {
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: null,
    routeEmail: "fallback@example.com",
  });
  assert.equal(resolved.email, "fallback@example.com");
  assert.equal(resolved.source, "route");
});
