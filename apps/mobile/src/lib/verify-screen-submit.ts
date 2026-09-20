/**
 * Screen-level OTP verify submit policy.
 * After one attempt for a generation, stay locked until code edit or new generation.
 * Mount/remount must never auto-begin an attempt.
 */

export type VerifySubmitSource = "button" | "keyboard" | "effect" | "other";

export type VerifyScreenSubmitPolicy = {
  readonly locked: boolean;
  readonly screenAttempt: number;
  canSubmit(generation: number, verifying: boolean, sending: boolean): boolean;
  beginAttempt(
    generation: number,
    source: VerifySubmitSource,
  ): {
    screen_attempt: number;
    source: string;
    generation: number;
    submitting: true;
    guard_locked: true;
  };
  /** Keep generation lock after verify returns (including 403). */
  releaseInFlightOnly(): void;
  clearForUserCodeEdit(): void;
  clearForNewGeneration(generation: number): void;
};

export function createVerifyScreenSubmitPolicy(): VerifyScreenSubmitPolicy {
  let locked = false;
  let attemptedGeneration: number | null = null;
  let screenAttempt = 0;

  return {
    get locked() {
      return locked;
    },
    get screenAttempt() {
      return screenAttempt;
    },
    canSubmit(generation: number, verifying: boolean, sending: boolean): boolean {
      if (locked || verifying || sending) {
        return false;
      }
      if (attemptedGeneration !== null && attemptedGeneration === generation) {
        return false;
      }
      return true;
    },
    beginAttempt(generation: number, source: VerifySubmitSource) {
      locked = true;
      attemptedGeneration = generation;
      screenAttempt += 1;
      return {
        screen_attempt: screenAttempt,
        source,
        generation,
        submitting: true as const,
        guard_locked: true as const,
      };
    },
    releaseInFlightOnly(): void {
      // Intentionally does not clear generation attempt — prevents post-403 loops.
    },
    clearForUserCodeEdit(): void {
      locked = false;
      attemptedGeneration = null;
    },
    clearForNewGeneration(_generation: number): void {
      locked = false;
      attemptedGeneration = null;
    },
  };
}
