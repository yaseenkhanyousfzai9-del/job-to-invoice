import type { FastifyInstance } from "fastify";
import { requireOwner, toMeData } from "../auth/context.ts";
import { successEnvelope } from "../envelope.ts";

export async function registerMeRoute(app: FastifyInstance): Promise<void> {
  app.get("/v1/me", async (request) => {
    const owner = requireOwner(request);
    return successEnvelope(request.id, toMeData(owner));
  });
}
