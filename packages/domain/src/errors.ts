export class AppError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode: number;
  readonly fieldErrors: Record<string, string[]>;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: string,
    message: string,
    retryable = false,
    statusCode = 400,
    fieldErrors: Record<string, string[]> = {},
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = retryable;
    this.statusCode = statusCode;
    this.fieldErrors = fieldErrors;
    this.details = details;
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
  details?: Record<string, unknown>,
): AppError {
  return new AppError(code, message, false, 409, fieldErrors, details);
}

/** Generic 404 — identical for unknown and cross-tenant ids (AUTHZ01 / QA03). */
export function notFound(message = "Not found."): AppError {
  return new AppError("NOT_FOUND", message, false, 404);
}
