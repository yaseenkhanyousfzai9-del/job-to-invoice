export type AppEnv = "development" | "staging" | "production";

export type ApiConfig = {
  appEnv: AppEnv;
  port: number;
  publicAppName: string;
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

export function loadApiConfig(
  env: Record<string, string | undefined> = process.env,
): ApiConfig {
  return {
    appEnv: parseAppEnv(env["APP_ENV"]),
    port: parsePort(env["API_PORT"]),
    publicAppName: env["PUBLIC_APP_NAME"] ?? "Job to Invoice",
  };
}
