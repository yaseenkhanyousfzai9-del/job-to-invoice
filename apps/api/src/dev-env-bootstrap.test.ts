import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadApiConfig } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("server entry imports load-dev-env before config", () => {
  const source = readFileSync(join(here, "server.ts"), "utf8");
  assert.match(source, /import\s+["']\.\/load-dev-env\.ts["']/);
  const loadIdx = source.indexOf("load-dev-env");
  const configIdx = source.indexOf("loadApiConfig");
  assert.ok(loadIdx >= 0 && configIdx > loadIdx);
});

test("dev and start scripts preload load-dev-env", () => {
  const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.match(pkg.scripts["dev"] ?? "", /load-dev-env/);
  assert.match(pkg.scripts["start"] ?? "", /load-dev-env/);
});

test("loadApiConfig requires AUTH_AUDIENCE for JWT verification path", () => {
  const incomplete = loadApiConfig({
    APP_ENV: "development",
    AUTH_ISSUER: undefined,
    AUTH_AUDIENCE: undefined,
    AUTH_JWKS_URL: undefined,
    AUTH_PROJECT_URL: undefined,
  });
  assert.equal(incomplete.authAudience, undefined);
  assert.equal(incomplete.authIssuer, undefined);

  const complete = loadApiConfig({
    APP_ENV: "development",
    AUTH_ISSUER: "https://example.supabase.co/auth/v1",
    AUTH_AUDIENCE: "authenticated",
    AUTH_JWKS_URL: "https://example.supabase.co/auth/v1/.well-known/jwks.json",
  });
  assert.equal(complete.authAudience, "authenticated");
  assert.equal(complete.authIssuer, "https://example.supabase.co/auth/v1");
  assert.ok(complete.authJwksUrl?.includes("jwks.json"));
});
