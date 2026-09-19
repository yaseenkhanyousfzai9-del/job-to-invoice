/**
 * Canonical OTP request: the email/generation from the latest successful signInWithOtp.
 * Route params are fallback only — never override a newer successful send.
 */

export type LatestOtpRequest = {
  email: string;
  generation: number;
};

export type ResolveVerifyEmailInput = {
  pendingEmail: string | null;
  routeEmail: string | string[] | undefined | null;
};

export type ResolveVerifyEmailResult = {
  email: string;
  source: "pending" | "route" | "none";
};

function normalizeRouteEmail(routeEmail: string | string[] | undefined | null): string {
  if (typeof routeEmail === "string") {
    return routeEmail.trim();
  }
  if (Array.isArray(routeEmail) && typeof routeEmail[0] === "string") {
    return routeEmail[0].trim();
  }
  return "";
}

/**
 * Prefer pendingEmail (latest successful send) over route params.
 */
export function resolveCanonicalVerifyEmail(
  input: ResolveVerifyEmailInput,
): ResolveVerifyEmailResult {
  const pending = input.pendingEmail?.trim() ?? "";
  if (pending.length > 0) {
    return { email: pending, source: "pending" };
  }
  const route = normalizeRouteEmail(input.routeEmail);
  if (route.length > 0) {
    return { email: route, source: "route" };
  }
  return { email: "", source: "none" };
}

export function createLatestOtpRequestState() {
  let request: LatestOtpRequest | null = null;
  return {
    get current(): LatestOtpRequest | null {
      return request;
    },
    /** After a successful signInWithOtp — replaces email and bumps generation. */
    recordSuccessfulSend(email: string): LatestOtpRequest {
      const next: LatestOtpRequest = {
        email,
        generation: (request?.generation ?? 0) + 1,
      };
      request = next;
      return next;
    },
    clear(): void {
      request = null;
    },
  };
}
