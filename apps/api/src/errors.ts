import { AppError } from "@job-to-invoice/domain";
import type { FastifyInstance } from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error, request_id: request.id }, "unhandled error");

    if (error instanceof AppError) {
      void reply.status(error.retryable ? 500 : 400).send({
        error: {
          code: error.code,
          message: error.message,
          field_errors: {},
          retryable: error.retryable,
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
