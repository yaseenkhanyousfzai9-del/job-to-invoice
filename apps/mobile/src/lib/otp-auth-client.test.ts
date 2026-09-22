import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildOtpAuthOptions } from "./otp-auth-client";
import { buildMobileAuthOptions } from "./mobile-auth-options";

const here = dirname(fileURLToPath(import.meta.url));

test("OTP client: persistSession = false", () => {
  assert.equal(buildOtpAuthOptions().persistSession, false);
});

test("OTP client: autoRefreshToken = false", () => {
  assert.equal(buildOtpAuthOptions().autoRefreshToken, false);
});

test("OTP client: detectSessionInUrl = false", () => {
  assert.equal(buildOtpAuthOptions().detectSessionInUrl, false);
});

test("OTP client does not set flowType (no PKCE)", () => {
  const options = buildOtpAuthOptions();
  assert.equal("flowType" in options, false);
  const source = readFileSync(join(here, "otp-auth-client.ts"), "utf8");
  assert.doesNotMatch(source, /flowType\s*:/);
  assert.doesNotMatch(source, /secureSessionStorage|SecureStore/);
});

test("persistent client still uses SecureStore persistence", () => {
  const memoryStorage = {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  };
  const options = buildMobileAuthOptions(memoryStorage);
  assert.equal(options.persistSession, true);
  assert.equal(options.autoRefreshToken, true);
  assert.equal(options.storage, memoryStorage);

  const supabaseSource = readFileSync(join(here, "supabase.ts"), "utf8");
  assert.match(supabaseSource, /secureSessionStorage/);
});

test("AuthProvider wires OTP client for send/verify and persistent for setSession", () => {
  const providerSource = readFileSync(join(here, "../providers/AuthProvider.tsx"), "utf8");
  assert.match(providerSource, /getOtpAuthClient/);
  assert.match(providerSource, /getSupabaseClient/);
  assert.match(providerSource, /otpClient\.auth\.signInWithOtp/);
  assert.match(providerSource, /otpClient\.auth\.verifyOtp/);
  assert.match(providerSource, /persistentClient\.auth\.setSession/);
  // Persistent client must not call verifyOtp / signInWithOtp.
  assert.doesNotMatch(providerSource, /getSupabaseClient\(\)[\s\S]{0,200}\.auth\.verifyOtp/);
  assert.doesNotMatch(providerSource, /getSupabaseClient\(\)[\s\S]{0,200}\.auth\.signInWithOtp/);
  // No manual SecureStore token writes in provider.
  assert.doesNotMatch(providerSource, /SecureStore\.(setItem|setItemAsync)/);
});
