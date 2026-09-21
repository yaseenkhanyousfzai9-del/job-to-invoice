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

function skipOwnerPreload(method: string, path: string): boolean {
  if (method !== "GET") return false;
  if (path === "/v1/customers" || path === "/v1/jobs") return true;
  if (/^\/v1\/customers\/[^/]+$/.test(path)) return true;
  return false;
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

    // Optimized GET reads resolve owner + resource in one DB transaction.
    if (skipOwnerPreload(request.method, requestPath(request.url))) {
      return;
    }

    // GET reads should not UPDATE last_authenticated_at on every list/filter call.
    const touchSession = request.method !== "GET";
    request.owner = await loadOwnerContext(deps.store, token, { touchSession });
  });
}
