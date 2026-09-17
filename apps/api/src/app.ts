import Fastify from "fastify";
import { registerErrorHandler } from "./errors.ts";
import { registerHealthRoute } from "./routes/health.ts";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env["APP_ENV"] === "production" ? "info" : "warn",
    },
    genReqId: (request) => {
      const existing = request.headers["x-request-id"];
      if (typeof existing === "string" && existing.length > 0) {
        return existing;
      }
      return crypto.randomUUID();
    },
    requestIdHeader: "x-request-id",
  });

  app.addHook("onSend", async (request, reply, payload) => {
    void reply.header("x-request-id", request.id);
    return payload;
  });

  registerErrorHandler(app);
  await registerHealthRoute(app);
  return app;
}
