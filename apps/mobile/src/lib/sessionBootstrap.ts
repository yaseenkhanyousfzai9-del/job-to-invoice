import type { MeData } from "@job-to-invoice/domain";
import { resolveOwnerNavigation } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import { mapProviderAuthError } from "./auth-errors";
import { BOOTSTRAP_FAILED_MESSAGE } from "./verify-auth-flow";

/** Bound session restore so SecureStore/Supabase network stalls cannot spin forever. */
export const SESSION_RESTORE_TIMEOUT_MS = 15_000;

export type SessionBootstrapResult =
  | { kind: "unconfigured" }
  | { kind: "no_session" }
  | {
      kind: "success";
      accessToken: string;
      me: MeData;
      navigation: "setup" | "app" | "suspended" | "deleting";
    }
  /**
   * Persistent session exists but /v1/me failed.
   * Session MUST be kept — never sign out for API/network/401 during cold start.
   */
  | { kind: "bootstrap_failed"; accessToken: string; message: string }
  | { kind: "session_error"; message: string };

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Cold-start / process-restart bootstrap.
 * Never calls signOut — transient API errors and even /v1/me 401 keep the persisted session.
 */
export async function runSessionBootstrap(options: {
  configured: boolean;
  getSession: () => Promise<{ session: { access_token: string } | null } | null>;
  fetchMe: (accessToken: string) => Promise<MeData>;
  /** @deprecated Ignored. Kept optional so callers/tests do not need a breaking rename. */
  signOut?: () => Promise<void>;
  sessionTimeoutMs?: number;
}): Promise<SessionBootstrapResult> {
  if (!options.configured) {
    return { kind: "unconfigured" };
  }

  const timeoutMs = options.sessionTimeoutMs ?? SESSION_RESTORE_TIMEOUT_MS;
  let accessToken: string | null = null;

  try {
    const data = await withTimeout(
      options.getSession(),
      timeoutMs,
      "SESSION_RESTORE_TIMEOUT",
    );
    accessToken = data?.session?.access_token ?? null;
    if (!accessToken) {
      return { kind: "no_session" };
    }

    try {
      const me = await options.fetchMe(accessToken);
      const navigation = resolveOwnerNavigation({ hasSession: true, me });
      if (
        navigation === "setup" ||
        navigation === "app" ||
        navigation === "suspended" ||
        navigation === "deleting"
      ) {
        return { kind: "success", accessToken, me, navigation };
      }
      return {
        kind: "bootstrap_failed",
        accessToken,
        message: BOOTSTRAP_FAILED_MESSAGE,
      };
    } catch (cause) {
      // Keep persisted session on 401, 5xx, and network — match retryBootstrap policy.
      void cause;
      if (cause instanceof DomainApiError) {
        return {
          kind: "bootstrap_failed",
          accessToken,
          message: BOOTSTRAP_FAILED_MESSAGE,
        };
      }
      return {
        kind: "bootstrap_failed",
        accessToken,
        message: BOOTSTRAP_FAILED_MESSAGE,
      };
    }
  } catch (cause) {
    if (cause instanceof Error && cause.message === "SESSION_RESTORE_TIMEOUT") {
      return {
        kind: "session_error",
        message: "Couldn’t restore your session in time. Check your connection and try again.",
      };
    }
    return {
      kind: "session_error",
      message: mapProviderAuthError(cause).message,
    };
  }
}
