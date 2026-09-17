import {
  conflict,
  ENTITLEMENT_PLACEHOLDER,
  isUuid,
  parseWorkspaceCreateBody,
  validationFailed,
  type MeData,
} from "@job-to-invoice/domain";
import type { FastifyInstance } from "fastify";
import { requireActiveOwner, requireOwner, toMeData } from "../auth/context.ts";
import { hashCanonicalJson, successEnvelope } from "../envelope.ts";
import type { AuthStore } from "../store/types.ts";

function workspaceResponse(me: MeData) {
  return {
    workspace: me.workspace,
    membership: me.membership,
    allowances: me.allowances,
    entitlement: ENTITLEMENT_PLACEHOLDER,
    version: me.workspace?.version ?? 1,
  };
}

export async function registerWorkspaceRoute(
  app: FastifyInstance,
  deps: { store: AuthStore },
): Promise<void> {
  app.post("/v1/workspace", async (request, reply) => {
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

    const fields = parseWorkspaceCreateBody(request.body);
    const requestHash = hashCanonicalJson(fields);

    return deps.store.withOwnerTransaction(owner.token.subject, async (tx) => {
      const existingKey = await tx.getIdempotency(owner.userId, idempotencyKey);
      if (existingKey) {
        if (existingKey.request_hash !== requestHash || existingKey.route !== "POST /v1/workspace") {
          throw conflict("IDEMPOTENCY_MISMATCH", "This Idempotency-Key was used with a different request.");
        }
        void reply.status(existingKey.status_code);
        return existingKey.response_json;
      }

      const existingWorkspace = await tx.findWorkspaceByOwner(owner.userId);
      if (existingWorkspace) {
        throw conflict("WORKSPACE_EXISTS", "A workspace already exists for this account.");
      }

      const now = new Date().toISOString();
      const bundle = await tx.createWorkspace({
        userId: owner.userId,
        fields,
        now,
      });
      const me = toMeData({
        ...owner,
        bundle,
      });
      const body = successEnvelope(request.id, workspaceResponse(me));
      await tx.putIdempotency({
        actor_scope: owner.userId,
        key: idempotencyKey,
        route: "POST /v1/workspace",
        request_hash: requestHash,
        status_code: 200,
        response_json: body,
      });
      return body;
    });
  });
}
