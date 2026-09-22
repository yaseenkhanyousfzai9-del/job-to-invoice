#!/usr/bin/env node
/**
 * Apply source-controlled migrations to the linked DEVELOPMENT project only.
 * Does not print connection strings or secrets.
 */
import { spawnSync } from "node:child_process";

const appEnv = process.env["APP_ENV"] ?? "development";
if (appEnv !== "development") {
  console.error("Refusing to push migrations: APP_ENV must be development.");
  process.exit(1);
}

const result = spawnSync("npx", ["supabase", "db", "push", "--yes"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
