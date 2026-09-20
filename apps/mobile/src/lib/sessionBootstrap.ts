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
  | { kind: "signed_out_401" }
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

export async function runSessionBootstrap(options: {
  configured: boolean;
  getSession: () => Promise<{ session: { access_token: string } | null } | null>;
  fetchMe: (accessToken: string) => Promise<MeData>;
  signOut: () => Promise<void>;
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
      if (cause instanceof DomainApiError && cause.api.status === 401) {
        await options.signOut();
        return { kind: "signed_out_401" };
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
