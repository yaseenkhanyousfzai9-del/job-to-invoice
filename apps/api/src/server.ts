import { buildApp } from "./app.ts";
import { loadApiConfig } from "./config.ts";

async function main(): Promise<void> {
  const config = loadApiConfig();
  const app = await buildApp();

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
