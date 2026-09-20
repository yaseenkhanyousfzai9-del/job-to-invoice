/**
 * DEV-only auth diagnostics. Never log tokens, emails, or session payloads.
 */

export type SignOutSource =
  | "explicit_user"
  | "bootstrap"
  | "401"
  | "session_restore"
  | "other";

let appSignOutInProgress = false;

export function isAppSignOutInProgress(): boolean {
  return appSignOutInProgress;
}

export function authSignOutTrace(input: {
  source: SignOutSource;
  reason: string;
  explicit_user_action: boolean;
  caller?: string;
}): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return;
  }
  console.warn("[auth-signout-trace]", {
    source: input.source,
    reason: input.reason,
    explicit_user_action: input.explicit_user_action,
    caller: input.caller ?? null,
  });
}

export async function withAppSignOutFlag<T>(fn: () => Promise<T>): Promise<T> {
  appSignOutInProgress = true;
  try {
    return await fn();
  } finally {
    appSignOutInProgress = false;
  }
}

export function authEventTrace(input: {
  event: string;
  app_signout_in_progress: boolean;
}): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return;
  }
  console.warn("[auth-event]", input);
}

export function secureSessionStorageTrace(input: {
  operation: "get" | "set" | "remove";
  key_present: boolean;
  value_present: boolean;
}): void {
  if (typeof __DEV__ !== "undefined" && !__DEV__) {
    return;
  }
  console.warn("[secure-session-storage]", input);
}
