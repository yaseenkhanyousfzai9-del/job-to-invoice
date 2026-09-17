import { loadWorkerConfig } from "./config.ts";

const config = loadWorkerConfig();

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.info(
    JSON.stringify({
      msg: "worker shutting down",
      signal,
      env: config.appEnv,
    }),
  );
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});

console.info(
  JSON.stringify({
    msg: "worker started",
    name: config.publicAppName,
    env: config.appEnv,
    note: "No outbox jobs are registered in CUST-FOUNDATION-01.",
  }),
);
