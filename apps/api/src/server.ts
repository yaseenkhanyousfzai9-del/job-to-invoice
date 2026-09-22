import "./load-dev-env.ts";
import { buildApp } from "./app.ts";
import { createConfiguredJwtVerifier } from "./auth/jwt.ts";
import { loadApiConfig } from "./config.ts";
import { createMemoryAuthStore } from "./store/memory.ts";
import { createPostgresAuthStore } from "./store/postgres.ts";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const jwtVerifier = createConfiguredJwtVerifier({
    jwksUrl: config.authJwksUrl,
    issuer: config.authIssuer,
    audience: config.authAudience,
  });
  if (!config.databaseUrlApi && config.appEnv !== "development") {
    throw new Error("DATABASE_URL_API is required outside development.");
  }

  const store = config.databaseUrlApi
    ? createPostgresAuthStore(config.databaseUrlApi)
    : createMemoryAuthStore().store;

  if (!config.databaseUrlApi) {
    console.warn(
      JSON.stringify({
        msg: "DATABASE_URL_API is unset; using in-memory auth store. Data is not durable.",
      }),
    );
  }

  const app = await buildApp({ jwtVerifier, store });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({ host: "0.0.0.0", port: config.port });
  app.log.info(
    { port: config.port, env: config.appEnv, name: config.publicAppName },
    "api listening",
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
