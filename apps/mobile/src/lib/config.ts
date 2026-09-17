export type MobilePublicConfig = {
  appEnv: string;
  appName: string;
  apiBaseUrl: string;
  authProjectUrl: string | undefined;
  authPublishableKey: string | undefined;
};

function optional(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  return value.trim();
}

export function loadMobileConfig(): MobilePublicConfig {
  return {
    appEnv: process.env["EXPO_PUBLIC_APP_ENV"] ?? "development",
    appName: process.env["EXPO_PUBLIC_APP_NAME"] ?? "Job to Invoice",
    apiBaseUrl: process.env["EXPO_PUBLIC_API_BASE_URL"] ?? "http://localhost:3001",
    authProjectUrl: optional(process.env["EXPO_PUBLIC_AUTH_PROJECT_URL"]),
    authPublishableKey: optional(process.env["EXPO_PUBLIC_AUTH_PUBLISHABLE_KEY"]),
  };
}

export function isAuthProviderConfigured(config: MobilePublicConfig = loadMobileConfig()): boolean {
  return Boolean(config.authProjectUrl && config.authPublishableKey);
}
