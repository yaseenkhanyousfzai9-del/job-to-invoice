export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode: number;
  readonly fieldErrors: Record<string, string[]>;

  constructor(
    code: string,
    message: string,
    retryable = false,
    statusCode = 400,
    fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
  }
}

export function validationFailed(
  fieldErrors: Record<string, string[]>,
  message = "Some fields need attention.",
): AppError {
  return new AppError("VALIDATION_FAILED", message, false, 422, fieldErrors);
}

export function unauthenticated(
  message = "Sign in to continue.",
): AppError {
  return new AppError("UNAUTHENTICATED", message, false, 401);
}

export function forbidden(
  code: string,
  message: string,
): AppError {
  return new AppError(code, message, false, 403);
}

export function conflict(
  code: string,
  message: string,
  fieldErrors: Record<string, string[]> = {},
): AppError {
  return new AppError(code, message, false, 409, fieldErrors);
}
