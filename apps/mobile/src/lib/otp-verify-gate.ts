/**
 * Per-OTP-generation verify lock.
 * In-flight single-flight alone is not enough: after a 403 finishes, a loop/remount
 * must not be allowed to call verifyOtp again for the same generation.
 */

export type OtpVerifyAttemptGate = {
  /** True if this generation has already invoked the provider. */
  hasAttempted(generation: number): boolean;
  /** Record that verifyOtp was invoked for this generation. */
  markProviderAttempted(generation: number): void;
  /** Clear lock when a new OTP send generation arrives. */
  clearForNewGeneration(generation: number): void;
  /** Clear lock after the user intentionally edits the code field. */
  clearForUserCodeEdit(): void;
  /** Whether a manual verify is allowed for this generation. */
  canAttempt(generation: number): boolean;
};

export function createOtpVerifyAttemptGate(): OtpVerifyAttemptGate {
  let attemptedGeneration: number | null = null;

  return {
    hasAttempted(generation: number): boolean {
      return attemptedGeneration === generation;
    },
    markProviderAttempted(generation: number): void {
      attemptedGeneration = generation;
    },
    clearForNewGeneration(generation: number): void {
      // A new generation always clears the prior attempt lock.
      if (attemptedGeneration !== generation) {
        attemptedGeneration = null;
      }
    },
    clearForUserCodeEdit(): void {
      attemptedGeneration = null;
    },
    canAttempt(generation: number): boolean {
      return attemptedGeneration !== generation;
    },
  };
}

export type RunGuardedVerifyResult =
  | { kind: "blocked_generation" }
  | { kind: "blocked_inflight" }
  | { kind: "ran"; providerCalls: number; result: unknown };

/**
 * Test helper: simulates provider entry with both inflight + generation gates.
 */
export async function runGuardedVerifyAttempt(options: {
  generation: number;
  flight: { tryBegin: () => boolean; end: () => void };
  gate: OtpVerifyAttemptGate;
  verifyOtp: () => Promise<unknown>;
}): Promise<RunGuardedVerifyResult> {
  if (!options.gate.canAttempt(options.generation)) {
    return { kind: "blocked_generation" };
  }
  if (!options.flight.tryBegin()) {
    return { kind: "blocked_inflight" };
  }
  let providerCalls = 0;
  try {
    options.gate.markProviderAttempted(options.generation);
    providerCalls += 1;
    const result = await options.verifyOtp();
    return { kind: "ran", providerCalls, result };
  } finally {
    options.flight.end();
  }
}
