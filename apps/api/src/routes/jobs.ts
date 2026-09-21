import {
  conflict,
  customerArchivedForJobCreate,
  isUuid,
  notFound,
  parseCreateJobInput,
  parseJobListQuery,
  validationFailed,
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

const CREATE_ROUTE = "POST /v1/jobs";

export async function registerJobsRoute(
  app: FastifyInstance,
  deps: { store: AuthStore },
): Promise<void> {
  app.get("/v1/jobs", async (request) => {
    const token = requireVerifiedAccessToken(request);
    const query = parseJobListQuery(request.query);

    let authorized = await deps.store.listJobsAuthorized(token.subject, query);
    if (authorized.status === "no_user") {
      await deps.store.withOwnerTransaction(token.subject, async (tx) => {
        await resolveOwnerInTransaction(tx, token, { touchSession: false });
      });
      authorized = await deps.store.listJobsAuthorized(token.subject, query);
      if (authorized.status === "no_user") {
        throw notFound();
      }
    }

    if (authorized.status === "customer_not_found") {
      throw notFound();
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

  app.post("/v1/jobs", async (request, reply) => {
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

    const fields = parseCreateJobInput(request.body);
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
        throw conflict("WORKSPACE_REQUIRED", "Create a workspace before creating jobs.");
      }

      const customer = await tx.getCustomer(bundle.workspace.id, fields.customer_id);
      if (!customer) {
        throw notFound();
      }
      if (customer.archived_at !== null) {
        throw customerArchivedForJobCreate();
      }

      const now = new Date().toISOString();
      const job = await tx.createJob({
        workspaceId: bundle.workspace.id,
        createdBy: owner.userId,
        fields,
        now,
      });
      const body = successEnvelope(request.id, job);
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
