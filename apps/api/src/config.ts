export type AppEnv = "development" | "staging" | "production";

export type ApiConfig = {
  appEnv: AppEnv;
  port: number;
  publicAppName: string;
  authIssuer: string | undefined;
  authAudience: string | undefined;
  authJwksUrl: string | undefined;
  databaseUrlApi: string | undefined;
};

function parseAppEnv(value: string | undefined): AppEnv {
  if (value === undefined || value === "") {
    return "development";
  }
  if (value === "development" || value === "staging" || value === "production") {
    return value;
  }
  throw new Error(`Invalid APP_ENV: ${value}`);
}

function parsePort(value: string | undefined): number {
  const parsed = Number(value ?? "3001");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("Invalid API_PORT");
  }
  return parsed;
}

function optional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

export function loadApiConfig(
  env: Record<string, string | undefined> = process.env,
): ApiConfig {
  const authIssuer = optional(env["AUTH_ISSUER"]);
  const authProjectUrl = optional(env["AUTH_PROJECT_URL"]);
  const authJwksUrl =
    optional(env["AUTH_JWKS_URL"]) ??
    (authIssuer ? `${authIssuer.replace(/\/$/, "")}/.well-known/jwks.json` : undefined) ??
    (authProjectUrl
      ? `${authProjectUrl.replace(/\/$/, "")}/auth/v1/.well-known/jwks.json`
      : undefined);

  return {
    appEnv: parseAppEnv(env["APP_ENV"]),
    port: parsePort(env["API_PORT"]),
    publicAppName: env["PUBLIC_APP_NAME"] ?? "Job to Invoice",
    authIssuer:
      authIssuer ??
      (authProjectUrl ? `${authProjectUrl.replace(/\/$/, "")}/auth/v1` : undefined),
    authAudience: optional(env["AUTH_AUDIENCE"]),
    authJwksUrl,
    databaseUrlApi: optional(env["DATABASE_URL_API"]),
  };
}
