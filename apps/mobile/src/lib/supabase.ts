import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppState, type AppStateStatus } from "react-native";
import { loadMobileConfig } from "./config";
import { buildMobileAuthOptions } from "./mobile-auth-options";
import { secureSessionStorage } from "./secure-session";

let client: SupabaseClient | null = null;
let appStateSubscribed = false;

function ensureAutoRefreshAppState(supabase: SupabaseClient): void {
  if (appStateSubscribed) {
    return;
  }
  appStateSubscribed = true;
  // React Native: pause refresh in background (supabase-js v2 documented pattern).
  AppState.addEventListener("change", (status: AppStateStatus) => {
    if (status === "active") {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}

/**
 * Persistent application auth client — module singleton only.
 * Do not create from AuthProvider render or route mounts.
 */
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
  ensureAutoRefreshAppState(client);
  return client;
}

/** Test helper: reset singleton between suites. */
export function resetSupabaseClientForTests(): void {
  client = null;
  appStateSubscribed = false;
}
