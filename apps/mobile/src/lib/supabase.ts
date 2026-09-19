import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadMobileConfig } from "./config";
import { buildMobileAuthOptions } from "./mobile-auth-options";
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
    auth: buildMobileAuthOptions(secureSessionStorage),
  });
  return client;
}
