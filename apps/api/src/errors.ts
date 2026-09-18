import { AppError } from "@job-to-invoice/domain";
import type { FastifyInstance } from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: unknown, request, reply) => {
    const err = error as { name?: string; message?: string; code?: string; statusCode?: number };
    request.log.error(
      {
        request_id: request.id,
        error_name: err.name ?? "Error",
        error_code: err.code,
        status_code: err.statusCode,
      },
      "request failed",
    );

    if (error instanceof AppError) {
      const body: {
        error: {
          code: string;
          message: string;
          field_errors: Record<string, string[]>;
          retryable: boolean;
          details?: Record<string, unknown>;
        };
        meta: { request_id: string };
      } = {
        error: {
          code: error.code,
          message: error.message,
          field_errors: error.fieldErrors,
          retryable: error.retryable,
        },
        meta: { request_id: request.id },
      };
      if (error.details !== undefined) {
        body.error.details = error.details;
      }
      void reply.status(error.statusCode).send(body);
      return;
    }

    if (typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500) {
      void reply.status(err.statusCode).send({
        error: {
          code: err.statusCode === 429 ? "RATE_LIMITED" : "UNAUTHENTICATED",
          message: "Request could not be completed.",
          field_errors: {},
          retryable: err.statusCode === 429,
        },
        meta: { request_id: request.id },
      });
      return;
    }

    void reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        field_errors: {},
        retryable: true,
      },
      meta: { request_id: request.id },
    });
  });
}

export function sendError(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  requestId: string,
  error: AppError,
): void {
  void reply.status(error.statusCode).send({
    error: {
      code: error.code,
      message: error.message,
      field_errors: error.fieldErrors,
      retryable: error.retryable,
    },
    meta: { request_id: requestId },
  });
}
