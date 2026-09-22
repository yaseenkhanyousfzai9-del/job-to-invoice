import { createVerifySingleFlight } from "./verify-auth-flow";

export type AuthFlowLog = (stage: string, extra?: Record<string, string | number | boolean | null>) => void;

export type SignInWithOtpFn = (input: {
  email: string;
}) => Promise<{
  error: { name?: string; status?: number; code?: string; message?: string } | null;
}>;

/** Reuse the same synchronous lock shape as verify. */
export function createSendSingleFlight() {
  return createVerifySingleFlight();
}

export type PrepareVerifyTokenResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

/**
 * Token prep for verifyOtp: trim only, then require exactly six digits.
 * No parseInt / Number conversion.
 */
export function prepareVerifyToken(raw: string): PrepareVerifyTokenResult {
  const token = raw.trim();
  if (token.length !== 6 || !/^\d{6}$/.test(token)) {
    return { ok: false, message: "Enter the 6-digit code." };
  }
  return { ok: true, token };
}

export function createOtpGenerationTracker() {
  let generation = 0;
  return {
    get current(): number {
      return generation;
    },
    /** Call only after a successful OTP send. */
    bump(): number {
      generation += 1;
      return generation;
    },
  };
}

export type SendOtpFlowResult =
  | { kind: "busy" }
  | { kind: "provider_error"; error: { name?: string; status?: number; code?: string; message?: string } }
  | { kind: "success"; generation: number };

export async function runSendOtpFlow(options: {
  email: string;
  signInWithOtp: SignInWithOtpFn;
  generation: { current: number; bump: () => number };
  flight: { tryBegin: () => boolean; end: () => void };
  sessionPresentBeforeOtp: boolean;
  log?: AuthFlowLog;
}): Promise<SendOtpFlowResult> {
  const log = options.log ?? (() => undefined);

  if (!options.flight.tryBegin()) {
    log("otp_send_blocked_duplicate");
    return { kind: "busy" };
  }

  try {
    log("otp_send_started", {
      session_present_before_otp: options.sessionPresentBeforeOtp,
    });
    // Match the working local probe: email only — no options/redirects.
    const { error } = await options.signInWithOtp({ email: options.email });
    if (error) {
      log("otp_send_provider_error", {
        status: error.status ?? null,
        code: error.code ?? null,
        message: error.message ?? null,
      });
      return { kind: "provider_error", error };
    }
    const generation = options.generation.bump();
    log("otp_send_success");
    log("otp_generation", { value: generation });
    return { kind: "success", generation };
  } finally {
    options.flight.end();
  }
}
