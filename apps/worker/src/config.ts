export type AppEnv = "development" | "staging" | "production";

export type WorkerConfig = {
  appEnv: AppEnv;
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

export function loadWorkerConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerConfig {
  return {
    appEnv: parseAppEnv(env["APP_ENV"]),
    publicAppName: env["PUBLIC_APP_NAME"] ?? "Job to Invoice",
  };
}
