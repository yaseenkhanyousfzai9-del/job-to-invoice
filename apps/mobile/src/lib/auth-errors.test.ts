import assert from "node:assert/strict";
import { test } from "node:test";
import { mapProviderAuthError, GENERIC_CODE_SENT } from "./auth-errors.ts";
import { isAuthProviderConfigured, type MobilePublicConfig } from "./config.ts";

test("generic OTP sent copy does not enumerate accounts", () => {
  assert.match(GENERIC_CODE_SENT, /If this email can receive/);
  assert.doesNotMatch(GENERIC_CODE_SENT.toLowerCase(), /account exists/);
});

test("wrong and expired provider codes share a generic message", () => {
  const invalid = mapProviderAuthError({ message: "Invalid OTP" });
  const expired = mapProviderAuthError({ message: "Token has expired" });
  assert.equal(invalid.message, expired.message);
  assert.equal(invalid.message, "That code is incorrect or expired.");
});

test("rate limits are generic and retryable", () => {
  const limited = mapProviderAuthError({ status: 429, message: "rate limit" });
  assert.equal(limited.code, "RATE_LIMITED");
  assert.equal(limited.retryable, true);
});

test("missing Auth project is a truthful configuration error", () => {
  const config: MobilePublicConfig = {
    appEnv: "development",
    appName: "Job to Invoice",
    apiBaseUrl: "http://localhost:3001",
    authProjectUrl: undefined,
    authPublishableKey: undefined,
  };
  assert.equal(isAuthProviderConfigured(config), false);
  const mapped = mapProviderAuthError(new Error("AUTH_NOT_CONFIGURED"));
  assert.equal(mapped.code, "AUTH_NOT_CONFIGURED");
});
