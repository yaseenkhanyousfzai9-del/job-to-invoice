import { notFound, parseJobListQuery } from "@job-to-invoice/domain";
import type { FastifyInstance } from "fastify";
import {
  requireActiveOwner,
  requireVerifiedAccessToken,
  resolveOwnerInTransaction,
} from "../auth/context.ts";
import { successEnvelope } from "../envelope.ts";
import type { AuthStore } from "../store/types.ts";

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
}
