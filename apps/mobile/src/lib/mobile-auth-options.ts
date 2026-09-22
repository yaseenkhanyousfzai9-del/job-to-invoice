import type { SupportedStorage } from "@supabase/supabase-js";

/**
 * Auth options for numeric email OTP (signInWithOtp + verifyOtp type email).
 * flowType is intentionally omitted so Supabase JS uses its default.
 */
export function buildMobileAuthOptions(storage: SupportedStorage) {
  return {
    persistSession: true as const,
    autoRefreshToken: true as const,
    detectSessionInUrl: false as const,
    storage,
  };
}
