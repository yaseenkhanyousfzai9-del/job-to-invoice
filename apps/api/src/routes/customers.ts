import {
  conflict,
  duplicateCustomerEmailConflict,
  isUuid,
  notFound,
  parseCreateCustomerInput,
  parseCustomerArchiveCommand,
  parseCustomerListQuery,
  parseIfMatchVersion,
  parseUpdateCustomerInput,
  validationFailed,
  versionConflict,
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

const CREATE_ROUTE = "POST /v1/customers";

function patchRoute(customerId: string): string {
  return `PATCH /v1/customers/${customerId}`;
}

function archiveRoute(customerId: string): string {
  return `POST /v1/customers/${customerId}/archive`;
}

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

  app.get<{ Params: { id: string } }>("/v1/customers/:id", async (request) => {
    const token = requireVerifiedAccessToken(request);
    const customerId = request.params.id;
    if (!isUuid(customerId)) {
      throw validationFailed({ id: ["Customer id must be a UUID."] });
    }

    let authorized = await deps.store.getCustomerAuthorized(token.subject, customerId);
    if (authorized.status === "no_user") {
      await deps.store.withOwnerTransaction(token.subject, async (tx) => {
        await resolveOwnerInTransaction(tx, token, { touchSession: false });
      });
      authorized = await deps.store.getCustomerAuthorized(token.subject, customerId);
      if (authorized.status === "no_user") {
        throw notFound();
      }
    }

    requireActiveOwner({
      token,
      userId: authorized.userId,
      displayEmail: authorized.displayEmail,
      status: authorized.accountStatus,
      bundle: null,
    });

    if (!authorized.customer) {
      throw notFound();
    }

    return successEnvelope(request.id, authorized.customer);
  });

  app.patch<{ Params: { id: string } }>("/v1/customers/:id", async (request, reply) => {
    const owner = requireOwner(request);
    requireActiveOwner(owner);

    const customerId = request.params.id;
    if (!isUuid(customerId)) {
      throw validationFailed({ id: ["Customer id must be a UUID."] });
    }

    const idempotencyKeyHeader = request.headers["idempotency-key"];
    const idempotencyKey =
      typeof idempotencyKeyHeader === "string" ? idempotencyKeyHeader : undefined;
    if (!idempotencyKey || !isUuid(idempotencyKey)) {
      throw validationFailed({
        "Idempotency-Key": ["A UUID Idempotency-Key is required."],
      });
    }

    const expectedVersion = parseIfMatchVersion(request.headers["if-match"]);
    const fields = parseUpdateCustomerInput(request.body);
    const route = patchRoute(customerId);
    const requestHash = hashCanonicalJson({
      ...fields,
      if_match: expectedVersion,
    });

    return deps.store.withOwnerTransaction(owner.token.subject, async (tx) => {
      const existingKey = await tx.getIdempotency(owner.userId, idempotencyKey);
      if (existingKey) {
        if (existingKey.request_hash !== requestHash || existingKey.route !== route) {
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
        throw conflict("WORKSPACE_REQUIRED", "Create a workspace before editing customers.");
      }

      if (fields.normalized_email !== undefined && fields.normalized_email !== null) {
        if (!fields.confirm_duplicate_email) {
          const duplicates = await tx.findCustomersByNormalizedEmail(
            bundle.workspace.id,
            fields.normalized_email,
            { excludeCustomerId: customerId },
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
              route,
              request_hash: requestHash,
              status_code: 409,
              response_json: body,
            });
            void reply.status(409);
            return body;
          }
        } else {
          await tx.findCustomersByNormalizedEmail(bundle.workspace.id, fields.normalized_email, {
            excludeCustomerId: customerId,
          });
        }
      }

      const now = new Date().toISOString();
      const result = await tx.updateCustomer({
        workspaceId: bundle.workspace.id,
        customerId,
        expectedVersion,
        fields,
        now,
      });

      if (result.status === "not_found") {
        throw notFound();
      }
      if (result.status === "version_conflict") {
        throw versionConflict(result.customer);
      }

      const body = successEnvelope(request.id, result.customer);
      await tx.putIdempotency({
        actor_scope: owner.userId,
        key: idempotencyKey,
        route,
        request_hash: requestHash,
        status_code: 200,
        response_json: body,
      });
      void reply.status(200);
      return body;
    });
  });

  app.post<{ Params: { id: string } }>("/v1/customers/:id/archive", async (request, reply) => {
    const owner = requireOwner(request);
    requireActiveOwner(owner);

    const customerId = request.params.id;
    if (!isUuid(customerId)) {
      throw validationFailed({ id: ["Customer id must be a UUID."] });
    }

    const idempotencyKeyHeader = request.headers["idempotency-key"];
    const idempotencyKey =
      typeof idempotencyKeyHeader === "string" ? idempotencyKeyHeader : undefined;
    if (!idempotencyKey || !isUuid(idempotencyKey)) {
      throw validationFailed({
        "Idempotency-Key": ["A UUID Idempotency-Key is required."],
      });
    }

    const command = parseCustomerArchiveCommand(request.body);
    const route = archiveRoute(customerId);
    const requestHash = hashCanonicalJson(command);

    return deps.store.withOwnerTransaction(owner.token.subject, async (tx) => {
      const existingKey = await tx.getIdempotency(owner.userId, idempotencyKey);
      if (existingKey) {
        if (existingKey.request_hash !== requestHash || existingKey.route !== route) {
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
        throw conflict("WORKSPACE_REQUIRED", "Create a workspace before archiving customers.");
      }

      const now = new Date().toISOString();
      const result = await tx.archiveCustomer({
        workspaceId: bundle.workspace.id,
        customerId,
        archived: command.archived,
        now,
      });

      if (result.status === "not_found") {
        throw notFound();
      }

      const body = successEnvelope(request.id, result.customer);
      await tx.putIdempotency({
        actor_scope: owner.userId,
        key: idempotencyKey,
        route,
        request_hash: requestHash,
        status_code: 200,
        response_json: body,
      });
      void reply.status(200);
      return body;
    });
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
        if (existingKey.request_hash !== requestHash || existingKey.route !== CREATE_ROUTE) {
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
            route: CREATE_ROUTE,
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
        route: CREATE_ROUTE,
        request_hash: requestHash,
        status_code: 201,
        response_json: body,
      });
      void reply.status(201);
      return body;
    });
  });
}
