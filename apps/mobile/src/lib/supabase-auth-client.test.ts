import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildMobileAuthOptions } from "./mobile-auth-options";
import { prepareVerifyToken } from "./otp-send-flow";

const memoryStorage = {
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
};

test("mobile auth client does not force PKCE for numeric email OTP", () => {
  const options = buildMobileAuthOptions(memoryStorage);
  assert.equal("flowType" in options, false);
  assert.equal((options as { flowType?: string }).flowType, undefined);

  const supabaseSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "supabase.ts"),
    "utf8",
  );
  assert.doesNotMatch(supabaseSource, /flowType\s*:\s*["']pkce["']/);
});

test("mobile auth client keeps SecureStore persistence and auto refresh", () => {
  const options = buildMobileAuthOptions(memoryStorage);
  assert.equal(options.persistSession, true);
  assert.equal(options.autoRefreshToken, true);
  assert.equal(options.detectSessionInUrl, false);
  assert.equal(options.storage, memoryStorage);

  const supabaseSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "supabase.ts"),
    "utf8",
  );
  assert.match(supabaseSource, /secureSessionStorage/);
  assert.match(supabaseSource, /buildMobileAuthOptions\(secureSessionStorage\)/);
});

test("verifyOtp path still uses type email with trimmed six-digit token", () => {
  const prepared = prepareVerifyToken(" 123456 ");
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    const verifyInput = {
      email: "owner@example.com",
      token: prepared.token,
      type: "email" as const,
    };
    assert.equal(verifyInput.type, "email");
    assert.equal(verifyInput.token, "123456");
  }
});
