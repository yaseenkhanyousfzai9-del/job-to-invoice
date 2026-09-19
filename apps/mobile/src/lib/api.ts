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

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new DomainApiError({
      code: "NETWORK",
      message: "Network problem. Check your connection and try again.",
      field_errors: {},
      retryable: true,
      status: 0,
    });
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
