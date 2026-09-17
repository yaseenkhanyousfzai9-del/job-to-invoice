import type { FastifyInstance } from "fastify";
import type { JwtVerifier } from "./jwt.ts";
import { loadOwnerContext, type OwnerContext } from "./context.ts";
import type { AuthStore } from "../store/types.ts";

declare module "fastify" {
  interface FastifyRequest {
    owner: OwnerContext | undefined;
  }
}

export function registerOwnerAuth(
  app: FastifyInstance,
  deps: { jwtVerifier: JwtVerifier; store: AuthStore },
): void {
  app.decorateRequest("owner", undefined);

  app.addHook("preHandler", async (request) => {
    if (request.url === "/health" || request.url.startsWith("/health?")) {
      return;
    }
    if (!request.url.startsWith("/v1/")) {
      return;
    }
    const token = await deps.jwtVerifier(request.headers.authorization);
    request.owner = await loadOwnerContext(deps.store, token);
  });
}
