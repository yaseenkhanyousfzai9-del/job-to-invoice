import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadMobileConfig } from "./config";
import { secureSessionStorage } from "./secure-session";

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (client) {
    return client;
  }
  const config = loadMobileConfig();
  if (!config.authProjectUrl || !config.authPublishableKey) {
    throw new Error("AUTH_NOT_CONFIGURED");
  }
  client = createClient(config.authProjectUrl, config.authPublishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: secureSessionStorage,
      flowType: "pkce",
    },
  });
  return client;
}
