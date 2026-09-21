import { validationFailed } from "./errors.ts";
import { isUuid } from "./ids.ts";
import { CUSTOMER_LIST_DEFAULT_LIMIT, CUSTOMER_LIST_MAX_LIMIT, CUSTOMER_NAME_MAX } from "./customer.ts";

export const JOB_TITLE_MIN = 1;
export const JOB_TITLE_MAX = 120;

export const JOB_LIFECYCLES = [
  "draft",
  "active",
  "invoiced",
  "finished",
  "canceled",
  "archived",
] as const;

export type JobLifecycle = (typeof JOB_LIFECYCLES)[number];

/** Public job summary for S19 associated jobs (DEC-CUST-006). */
export type JobSummary = {
  id: string;
  title: string;
  lifecycle: JobLifecycle;
  updated_at: string;
  customer_id: string;
};

/**
 * Job list filter for GET /v1/jobs.
 * `customer_id` is required for CUST-API-03 associated-jobs reads.
 * `state`: `all` (default), `active` (not archived), `archived`, or a specific lifecycle.
 */
export type JobListState = "all" | "active" | "archived" | JobLifecycle;

export type JobListQuery = {
  customer_id: string;
  cursor: string | null;
  limit: number;
  search: string | null;
  state: JobListState;
};

const LIST_ALLOWED = new Set(["customer_id", "cursor", "limit", "search", "state"]);

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  fieldErrors: Record<string, string[]>,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      fieldErrors[key] = ["Unknown field."];
    }
  }
}

function isJobLifecycle(value: unknown): value is JobLifecycle {
  return typeof value === "string" && (JOB_LIFECYCLES as readonly string[]).includes(value);
}

export function parseJobListQuery(raw: unknown): JobListQuery {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ query: ["Invalid list query."] });
  }
  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  rejectUnknownKeys(body, LIST_ALLOWED, fieldErrors);

  let customerId: string | undefined;
  if (body["customer_id"] === undefined || body["customer_id"] === null) {
    fieldErrors["customer_id"] = ["customer_id is required."];
  } else if (typeof body["customer_id"] !== "string" || !isUuid(body["customer_id"])) {
    fieldErrors["customer_id"] = ["customer_id must be a UUID."];
  } else {
    customerId = body["customer_id"];
  }

  let search: string | null = null;
  if (body["search"] !== undefined && body["search"] !== null) {
    if (typeof body["search"] !== "string") {
      fieldErrors["search"] = ["Search must be text."];
    } else {
      const trimmed = body["search"].trim();
      if (trimmed.length > CUSTOMER_NAME_MAX) {
        fieldErrors["search"] = [`Search must be at most ${CUSTOMER_NAME_MAX} characters.`];
      } else {
        search = trimmed.length > 0 ? trimmed : null;
      }
    }
  }

  let cursor: string | null = null;
  if (body["cursor"] !== undefined && body["cursor"] !== null) {
    if (typeof body["cursor"] !== "string" || body["cursor"].trim().length === 0) {
      fieldErrors["cursor"] = ["Cursor is invalid."];
    } else {
      cursor = body["cursor"];
    }
  }

  let limit = CUSTOMER_LIST_DEFAULT_LIMIT;
  if (body["limit"] !== undefined && body["limit"] !== null) {
    const parsed =
      typeof body["limit"] === "number"
        ? body["limit"]
        : typeof body["limit"] === "string"
          ? Number(body["limit"])
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      fieldErrors["limit"] = ["Limit must be an integer from 1 to 100."];
    } else if (parsed > CUSTOMER_LIST_MAX_LIMIT) {
      fieldErrors["limit"] = ["Limit must be at most 100."];
    } else {
      limit = parsed;
    }
  }

  let state: JobListState = "all";
  if (body["state"] !== undefined && body["state"] !== null) {
    if (
      body["state"] !== "all" &&
      body["state"] !== "active" &&
      body["state"] !== "archived" &&
      !isJobLifecycle(body["state"])
    ) {
      fieldErrors["state"] = ["State is invalid."];
    } else {
      state = body["state"] as JobListState;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }

  return {
    customer_id: customerId as string,
    cursor,
    limit,
    search,
    state,
  };
}
