export type MappedAuthError = {
  code: string;
  message: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
};

export function mapProviderAuthError(error: unknown): MappedAuthError {
  const status = (error as { status?: number }).status;
  const message = (error as { message?: string }).message ?? "";
  const normalized = message.toLowerCase();

  if ((error as { message?: string }).message === "AUTH_NOT_CONFIGURED" || message === "AUTH_NOT_CONFIGURED") {
    return {
      code: "AUTH_NOT_CONFIGURED",
      message: "Sign-in is not connected to a development Auth project yet.",
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (status === 429 || normalized.includes("rate") || normalized.includes("too many")) {
    return {
      code: "RATE_LIMITED",
      message: "Too many attempts. Wait before trying again.",
      retryable: true,
      retryAfterSeconds: 60,
    };
  }

  if (normalized.includes("expired")) {
    return {
      code: "OTP_EXPIRED",
      message: "That code is incorrect or expired.",
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (normalized.includes("invalid") || normalized.includes("otp") || normalized.includes("token")) {
    return {
      code: "OTP_INVALID",
      message: "That code is incorrect or expired.",
      retryable: false,
      retryAfterSeconds: null,
    };
  }

  if (normalized.includes("network") || normalized.includes("fetch") || (error as { name?: string }).name === "TypeError") {
    return {
      code: "NETWORK",
      message: "Network problem. Check your connection and try again.",
      retryable: true,
      retryAfterSeconds: null,
    };
  }

  return {
    code: "AUTH_GENERIC",
    message: "We could not complete that request. Try again.",
    retryable: true,
    retryAfterSeconds: null,
  };
}

export const GENERIC_CODE_SENT =
  "If this email can receive a sign-in code, it should arrive shortly.";
