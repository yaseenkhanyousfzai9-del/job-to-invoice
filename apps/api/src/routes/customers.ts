import {
  conflict,
  duplicateCustomerEmailConflict,
  isUuid,
  parseCreateCustomerInput,
  parseCustomerListQuery,
  validationFailed,
  type Customer,
} from "@job-to-invoice/domain";
import type { FastifyInstance } from "fastify";
import {
  requireActiveOwner,
  requireOwner,
  requireVerifiedAccessToken,
  resolveOwnerInTransaction,
} from "../auth/context.ts";
import { hashCanonicalJson, successEnvelope } from "../envelope.ts";
import type { AuthStore } from "../store/types.ts";

const ROUTE = "POST /v1/customers";

function customerErrorEnvelope(
  requestId: string,
  error: {
    code: string;
    message: string;
    fieldErrors: Record<string, string[]>;
    retryable: boolean;
    details?: Record<string, unknown>;
  },
) {
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
    meta: { request_id: requestId },
  };
  if (error.details !== undefined) {
    body.error.details = error.details;
  }
  return body;
}

export async function registerCustomersRoute(
  app: FastifyInstance,
  deps: { store: AuthStore },
): Promise<void> {
  app.get("/v1/customers", async (request) => {
    const token = requireVerifiedAccessToken(request);
    const query = parseCustomerListQuery(request.query);

    let authorized = await deps.store.listCustomersAuthorized(token.subject, query);
    if (authorized.status === "no_user") {
      // First authenticated request may need app_users insert; keep AUTHZ01 in one follow-up tx.
      await deps.store.withOwnerTransaction(token.subject, async (tx) => {
        await resolveOwnerInTransaction(tx, token, { touchSession: false });
      });
      authorized = await deps.store.listCustomersAuthorized(token.subject, query);
      if (authorized.status === "no_user") {
        return successEnvelope(request.id, { items: [], next_cursor: null });
      }
    }

    requireActiveOwner({
      token,
      userId: authorized.userId,
      displayEmail: authorized.displayEmail,
      status: authorized.accountStatus,
      bundle: null,
    });

    return successEnvelope(request.id, authorized.page);
  });

  app.post("/v1/customers", async (request, reply) => {
    const owner = requireOwner(request);
    requireActiveOwner(owner);

    const idempotencyKeyHeader = request.headers["idempotency-key"];
    const idempotencyKey =
      typeof idempotencyKeyHeader === "string" ? idempotencyKeyHeader : undefined;
    if (!idempotencyKey || !isUuid(idempotencyKey)) {
      throw validationFailed({
        "Idempotency-Key": ["A UUID Idempotency-Key is required."],
      });
    }

    const fields = parseCreateCustomerInput(request.body);
    const requestHash = hashCanonicalJson(fields);

    return deps.store.withOwnerTransaction(owner.token.subject, async (tx) => {
      const existingKey = await tx.getIdempotency(owner.userId, idempotencyKey);
      if (existingKey) {
        if (existingKey.request_hash !== requestHash || existingKey.route !== ROUTE) {
          throw conflict(
            "IDEMPOTENCY_MISMATCH",
            "This Idempotency-Key was used with a different request.",
          );
        }
        void reply.status(existingKey.status_code);
        return existingKey.response_json;
      }

      const bundle = await tx.findWorkspaceByOwner(owner.userId);
      if (!bundle) {
        throw conflict("WORKSPACE_REQUIRED", "Create a workspace before adding customers.");
      }

      if (fields.normalized_email !== null && !fields.confirm_duplicate_email) {
        const duplicates = await tx.findCustomersByNormalizedEmail(
          bundle.workspace.id,
          fields.normalized_email,
        );
        if (duplicates.length > 0) {
          const appError = duplicateCustomerEmailConflict(duplicates);
          const body = customerErrorEnvelope(request.id, {
            code: appError.code,
            message: appError.message,
            fieldErrors: appError.fieldErrors,
            retryable: appError.retryable,
            ...(appError.details !== undefined ? { details: appError.details } : {}),
          });
          await tx.putIdempotency({
            actor_scope: owner.userId,
            key: idempotencyKey,
            route: ROUTE,
            request_hash: requestHash,
            status_code: 409,
            response_json: body,
          });
          void reply.status(409);
          return body;
        }
      } else if (fields.normalized_email !== null && fields.confirm_duplicate_email) {
        // Recheck still runs so confirmation is never based on a stale prior response alone.
        await tx.findCustomersByNormalizedEmail(bundle.workspace.id, fields.normalized_email);
      }

      const now = new Date().toISOString();
      const customer: Customer = await tx.createCustomer({
        workspaceId: bundle.workspace.id,
        createdBy: owner.userId,
        fields,
        now,
      });
      const body = successEnvelope(request.id, customer);
      await tx.putIdempotency({
        actor_scope: owner.userId,
        key: idempotencyKey,
        route: ROUTE,
        request_hash: requestHash,
        status_code: 201,
        response_json: body,
      });
      void reply.status(201);
      return body;
    });
  });
}
