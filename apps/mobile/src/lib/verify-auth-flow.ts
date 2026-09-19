import type { MeData } from "@job-to-invoice/domain";
import { resolveOwnerNavigation } from "@job-to-invoice/domain";
import { DomainApiError } from "./api";
import { mapProviderAuthError } from "./auth-errors";

export const BOOTSTRAP_FAILED_MESSAGE =
  "You’re signed in, but we couldn’t load your account. Try again.";

export type VerifyOtpFn = (input: {
  email: string;
  token: string;
  type: "email";
}) => Promise<{
  data: { session: { access_token: string } | null };
  error: { name?: string; status?: number; code?: string; message?: string } | null;
}>;

export type FetchMeFn = (accessToken: string) => Promise<MeData>;

export type AuthFlowLog = (stage: string, extra?: Record<string, string | number | boolean | null>) => void;

export type VerifyAuthFlowResult =
  | { kind: "busy" }
  | { kind: "otp_invalid"; message: string }
  | { kind: "bootstrap_failed"; message: string; accessToken: string }
  | {
      kind: "success";
      accessToken: string;
      me: MeData;
      navigationTarget: "setup" | "app" | "suspended" | "deleting";
    };

export function createVerifySingleFlight() {
  let inFlight = false;
  return {
    tryBegin(): boolean {
      if (inFlight) {
        return false;
      }
      inFlight = true;
      return true;
    },
    end(): void {
      inFlight = false;
    },
    get active(): boolean {
      return inFlight;
    },
  };
}

export async function runVerifyAuthFlow(options: {
  email: string;
  code: string;
  verifyOtp: VerifyOtpFn;
  fetchMe: FetchMeFn;
  log?: AuthFlowLog;
}): Promise<VerifyAuthFlowResult> {
  const log = options.log ?? (() => undefined);
  log("verify_started");

  const { data, error: providerError } = await options.verifyOtp({
    email: options.email,
    token: options.code,
    type: "email",
  });

  if (providerError || !data.session) {
    if (providerError) {
      log("verify_provider_error", {
        status: providerError.status ?? null,
        code: providerError.code ?? null,
        message: providerError.message ?? null,
      });
    } else {
      log("verify_provider_error", {
        status: null,
        code: null,
        message: "verifyOtp returned no session",
      });
    }
    log("session_present", { value: false });
    return {
      kind: "otp_invalid",
      message: mapProviderAuthError(providerError ?? new Error("invalid")).message,
    };
  }

  log("verify_success");
  log("session_present", { value: true });
  const accessToken = data.session.access_token;

  log("bootstrap_started");
  try {
    const me = await options.fetchMe(accessToken);
    log("bootstrap_success");
    const navigation = resolveOwnerNavigation({ hasSession: true, me });
    const navigationTarget =
      navigation === "setup" ||
      navigation === "app" ||
      navigation === "suspended" ||
      navigation === "deleting"
        ? navigation
        : "setup";
    log("navigation_target", {
      value: navigationTarget === "app" ? "owner-shell" : navigationTarget,
    });
    return {
      kind: "success",
      accessToken,
      me,
      navigationTarget,
    };
  } catch (cause) {
    const status =
      cause instanceof DomainApiError ? cause.api.status : cause instanceof Error ? null : null;
    const code = cause instanceof DomainApiError ? cause.api.code : null;
    log("bootstrap_status", {
      status: status ?? null,
      code: code ?? null,
    });
    return {
      kind: "bootstrap_failed",
      message: BOOTSTRAP_FAILED_MESSAGE,
      accessToken,
    };
  }
}
