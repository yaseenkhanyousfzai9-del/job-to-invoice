import type { Customer, CustomerListState, JobSummary, MeData } from "@job-to-invoice/domain";
import { loadMobileConfig } from "./config";
import { createClientUuid } from "./clientUuid";

export type CustomerListPage = {
  items: Customer[];
  next_cursor: string | null;
};

export type JobListPage = {
  items: JobSummary[];
  next_cursor: string | null;
};

export type ListCustomersParams = {
  state?: CustomerListState;
  search?: string | null;
  limit?: number;
  cursor?: string | null;
};

export type ListJobsParams = {
  customerId: string;
  limit?: number;
  cursor?: string | null;
  search?: string | null;
  state?: string;
};

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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  accessToken: string;
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string | number;
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
  if (options.ifMatch !== undefined) {
    headers["If-Match"] = String(options.ifMatch);
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

export function buildListCustomersPath(params: ListCustomersParams = {}): string {
  const query = new URLSearchParams();
  query.set("state", params.state ?? "active");
  query.set("limit", String(params.limit ?? 25));
  const search = typeof params.search === "string" ? params.search.trim() : "";
  if (search.length > 0) {
    query.set("search", search);
  }
  if (typeof params.cursor === "string" && params.cursor.length > 0) {
    query.set("cursor", params.cursor);
  }
  return `/v1/customers?${query.toString()}`;
}

export async function listCustomers(
  accessToken: string,
  params: ListCustomersParams = {},
): Promise<CustomerListPage> {
  return apiRequest<CustomerListPage>(buildListCustomersPath(params), { accessToken });
}

export function buildGetCustomerPath(customerId: string): string {
  return `/v1/customers/${customerId}`;
}

export async function getCustomer(accessToken: string, customerId: string): Promise<Customer> {
  return apiRequest<Customer>(buildGetCustomerPath(customerId), { accessToken });
}

export function buildPatchCustomerPath(customerId: string): string {
  return `/v1/customers/${customerId}`;
}

export async function patchCustomer(
  accessToken: string,
  customerId: string,
  body: unknown,
  options: { idempotencyKey: string; ifMatch: number },
): Promise<Customer> {
  return apiRequest<Customer>(buildPatchCustomerPath(customerId), {
    method: "PATCH",
    accessToken,
    body,
    idempotencyKey: options.idempotencyKey,
    ifMatch: options.ifMatch,
  });
}

export function buildArchiveCustomerPath(customerId: string): string {
  return `/v1/customers/${customerId}/archive`;
}

export async function archiveCustomer(
  accessToken: string,
  customerId: string,
  archived: boolean,
  idempotencyKey: string,
): Promise<Customer> {
  return apiRequest<Customer>(buildArchiveCustomerPath(customerId), {
    method: "POST",
    accessToken,
    body: { archived },
    idempotencyKey,
  });
}

export function buildDeleteCustomerPath(customerId: string): string {
  return `/v1/customers/${customerId}`;
}

export type DeleteCustomerResult = {
  deleted: true;
};

export async function deleteCustomer(
  accessToken: string,
  customerId: string,
  idempotencyKey: string,
): Promise<DeleteCustomerResult> {
  return apiRequest<DeleteCustomerResult>(buildDeleteCustomerPath(customerId), {
    method: "DELETE",
    accessToken,
    idempotencyKey,
  });
}

export const JOBS_LIST_DEFAULT_LIMIT = 25;

export function buildListJobsPath(params: ListJobsParams): string {
  const query = new URLSearchParams();
  query.set("customer_id", params.customerId);
  query.set("limit", String(params.limit ?? JOBS_LIST_DEFAULT_LIMIT));
  if (typeof params.cursor === "string" && params.cursor.length > 0) {
    query.set("cursor", params.cursor);
  }
  if (typeof params.search === "string" && params.search.trim().length > 0) {
    query.set("search", params.search.trim());
  }
  if (typeof params.state === "string" && params.state.length > 0) {
    query.set("state", params.state);
  }
  return `/v1/jobs?${query.toString()}`;
}

export async function listJobs(
  accessToken: string,
  params: ListJobsParams,
): Promise<JobListPage> {
  return apiRequest<JobListPage>(buildListJobsPath(params), { accessToken });
}
