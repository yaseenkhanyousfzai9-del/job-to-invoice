import type { FastifyInstance } from "fastify";
import type { JwtVerifier, VerifiedAccessToken } from "./jwt.ts";
import { loadOwnerContext, type OwnerContext } from "./context.ts";
import type { AuthStore } from "../store/types.ts";

declare module "fastify" {
  interface FastifyRequest {
    owner: OwnerContext | undefined;
    verifiedAccessToken: VerifiedAccessToken | undefined;
  }
}

function requestPath(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

export function registerOwnerAuth(
  app: FastifyInstance,
  deps: { jwtVerifier: JwtVerifier; store: AuthStore },
): void {
  app.decorateRequest("owner", undefined);
  app.decorateRequest("verifiedAccessToken", undefined);

  app.addHook("preHandler", async (request) => {
    if (request.url === "/health" || request.url.startsWith("/health?")) {
      return;
    }
    if (!request.url.startsWith("/v1/")) {
      return;
    }

    const token = await deps.jwtVerifier(request.headers.authorization);
    request.verifiedAccessToken = token;

    // GET /v1/customers resolves owner + list in one DB transaction (remote RTT).
    if (request.method === "GET" && requestPath(request.url) === "/v1/customers") {
      return;
    }

    // GET reads should not UPDATE last_authenticated_at on every list/filter call.
    const touchSession = request.method !== "GET";
    request.owner = await loadOwnerContext(deps.store, token, { touchSession });
  });
}
