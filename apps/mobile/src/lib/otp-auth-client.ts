import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadMobileConfig } from "./config";

/**
 * Stateless OTP transport client options.
 * Matches the successful local verify-only probe: no persistence, no refresh, no URL detection.
 * flowType is intentionally omitted (never force PKCE for numeric email OTP).
 */
export function buildOtpAuthOptions() {
  return {
    persistSession: false as const,
    autoRefreshToken: false as const,
    detectSessionInUrl: false as const,
  };
}

let otpClient: SupabaseClient | null = null;

/**
 * Dedicated client for signInWithOtp + verifyOtp only.
 * Must not be used for session restore, sign-out, or authenticated API calls.
 */
export function getOtpAuthClient(): SupabaseClient {
  if (otpClient) {
    return otpClient;
  }
  const config = loadMobileConfig();
  if (!config.authProjectUrl || !config.authPublishableKey) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }
  otpClient = createClient(config.authProjectUrl, config.authPublishableKey, {
    auth: buildOtpAuthOptions(),
  });
  return otpClient;
}

/** Test helper: reset singleton between suites. */
export function resetOtpAuthClientForTests(): void {
  otpClient = null;
}
