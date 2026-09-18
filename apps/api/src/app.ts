import Fastify from "fastify";
import type { JwtVerifier } from "./auth/jwt.ts";
import { registerOwnerAuth } from "./auth/plugin.ts";
import { registerErrorHandler } from "./errors.ts";
import { registerCustomersRoute } from "./routes/customers.ts";
import { registerHealthRoute } from "./routes/health.ts";
import { registerMeRoute } from "./routes/me.ts";
import { registerWorkspaceRoute } from "./routes/workspace.ts";
import type { AuthStore } from "./store/types.ts";

export type AppDependencies = {
  jwtVerifier: JwtVerifier;
  store: AuthStore;
};

export async function buildApp(deps: AppDependencies) {
  const app = Fastify({
    logger: {
      level: process.env["APP_ENV"] === "production" ? "info" : "warn",
      serializers: {
        req(request) {
          return {
            method: request.method,
            url: request.url,
            hostname: request.hostname,
          };
        },
      },
    },
    genReqId: (request) => {
      const existing = request.headers["x-request-id"];
      if (typeof existing === "string" && existing.length > 0) {
        return existing;
      }
      return crypto.randomUUID();
    },
    requestIdHeader: "x-request-id",
    bodyLimit: 64 * 1024,
  });

  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("x-request-id", request.id);
    return payload;
  });

  registerErrorHandler(app);
  registerOwnerAuth(app, deps);
  await registerHealthRoute(app);
  await registerMeRoute(app);
  await registerWorkspaceRoute(app, deps);
  await registerCustomersRoute(app, deps);
  return app;
}
