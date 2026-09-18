import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads gitignored development env for local/live API tests.
 * Never logs values. Does not override already-set process.env keys.
 */
function loadDevelopmentEnvFile(): void {
  const candidates = [
    resolve(process.cwd(), ".env.development.local"),
    resolve(process.cwd(), "../.env.development.local"),
    resolve(process.cwd(), "apps/api/.env.development.local"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed === "" || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined || process.env[key] === "") {
        process.env[key] = value;
      }
    }
    return;
  }
}

loadDevelopmentEnvFile();
