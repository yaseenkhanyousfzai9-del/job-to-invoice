import type { Customer, MeData } from "@job-to-invoice/domain";
import { loadMobileConfig } from "./config";
import { createClientUuid } from "./clientUuid";

export type ApiError = {
  code: string;
  message: string;
  field_errors: Record<string, string[]>;
  retryable: boolean;
  status: number;
  details?: Record<string, unknown>;
};

export class DomainApiError extends Error {
  readonly api: ApiError;

  constructor(api: ApiError) {
    super(api.message);
    this.name = "DomainApiError";
    this.api = api;
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  accessToken: string;
  body?: unknown;
  idempotencyKey?: string;
};

/** Prevent indefinite startup spinner when the LAN API is unreachable. */
export const API_FETCH_TIMEOUT_MS = 20_000;

export async function apiRequest<T>(path: string, options: RequestOptions): Promise<T> {
  const config = loadMobileConfig();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    "X-Request-Id": createClientUuid(),
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // React Native's AbortSignal typings differ from DOM; runtime behavior is correct.
      signal: controller.signal as RequestInit["signal"],
    });
  } catch (cause) {
    throw new DomainApiError({
      code: "NETWORK",
      message:
        cause instanceof Error && cause.name === "AbortError"
          ? "Request timed out. Check that the API is reachable and try again."
          : "Network problem. Check your connection and try again.",
      field_errors: {},
      retryable: true,
      status: 0,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const json = (await response.json().catch(() => null)) as
    | {
        data?: T;
        error?: {
          code?: string;
          message?: string;
          field_errors?: Record<string, string[]>;
          retryable?: boolean;
          details?: Record<string, unknown>;
        };
      }
    | null;

  if (!response.ok) {
    const apiError: ApiError = {
      code: json?.error?.code ?? (response.status === 401 ? "UNAUTHENTICATED" : "INTERNAL_ERROR"),
      message:
        json?.error?.message ??
        (response.status === 401 ? "Sign in to continue." : "An unexpected error occurred."),
      field_errors: json?.error?.field_errors ?? {},
      retryable: json?.error?.retryable ?? response.status >= 500,
      status: response.status,
    };
    if (json?.error?.details !== undefined) {
      apiError.details = json.error.details;
    }
    throw new DomainApiError(apiError);
  }

  return json?.data as T;
}

export async function fetchMe(accessToken: string): Promise<MeData> {
  return apiRequest<MeData>("/v1/me", { accessToken });
}

export async function createWorkspace(
  accessToken: string,
  body: unknown,
  idempotencyKey: string,
): Promise<unknown> {
  return apiRequest("/v1/workspace", {
    method: "POST",
    accessToken,
    body,
    idempotencyKey,
  });
}

export async function createCustomer(
  accessToken: string,
  body: unknown,
  idempotencyKey: string,
): Promise<Customer> {
  return apiRequest<Customer>("/v1/customers", {
    method: "POST",
    accessToken,
    body,
    idempotencyKey,
  });
}
