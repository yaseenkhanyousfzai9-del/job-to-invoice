import { parseUsAddress, type UsAddress } from "./address.ts";
import { AppError, validationFailed } from "./errors.ts";
import { isUuid } from "./ids.ts";
import { CUSTOMER_LIST_DEFAULT_LIMIT, CUSTOMER_LIST_MAX_LIMIT, CUSTOMER_NAME_MAX } from "./customer.ts";
import { requireBoundedName } from "./text.ts";

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

export const JOB_MODES = ["quote", "direct_invoice"] as const;
export type JobMode = (typeof JOB_MODES)[number];

/** Minimal public customer summary on Job cards (DEC-JOB-001 / S05). */
export type JobCustomerSummary = {
  id: string;
  name: string;
};

/** Public job summary for S19 associated jobs and S05 Jobs list (DEC-CUST-006, DEC-JOB-001). */
export type JobSummary = {
  id: string;
  title: string;
  lifecycle: JobLifecycle;
  updated_at: string;
  customer_id: string;
  customer: JobCustomerSummary;
};

/** Create response: JobSummary plus create-time confirmation fields (not entitlement/internal). */
export type CreatedJob = JobSummary & {
  version: number;
  scope_version: number;
  no_site: boolean;
  site_address: UsAddress | null;
  mode: JobMode;
};

export type CreateJobInput = {
  id: string;
  customer_id: string;
  title: string;
  site_address: UsAddress | null;
  no_site: boolean;
  mode: JobMode;
};

export const CUSTOMER_ARCHIVED = "CUSTOMER_ARCHIVED";

export function customerArchivedForJobCreate(): AppError {
  return new AppError(
    CUSTOMER_ARCHIVED,
    "Restore this customer before creating a new job.",
    false,
    422,
    { customer_id: ["This customer is archived."] },
  );
}

const CREATE_ALLOWED = new Set([
  "id",
  "customer_id",
  "title",
  "site_address",
  "no_site",
  "mode",
]);

const CREATE_FORBIDDEN_SERVER_FIELDS = [
  "workspace_id",
  "version",
  "created_at",
  "updated_at",
  "created_by",
  "lifecycle",
  "archived_from_state",
  "current_quote_id",
  "active_invoice_id",
  "scope_version",
  "first_published_at",
  "entitlement_origin",
  "completion_right",
  "internal_notes",
  "related_job_id",
] as const;

/**
 * Legacy `state` filter for GET /v1/jobs (customer-scoped and general).
 * `active` means lifecycle <> archived (legacy; not the S05 Active bucket).
 */
export type JobListState = "all" | "active" | "archived" | JobLifecycle;

/**
 * S05 Jobs-tab buckets (DEC-JOB-001). Mutually exclusive with `state`.
 * active → draft|active|invoiced; finished → finished|canceled; archived → archived.
 */
export type JobListBucket = "active" | "finished" | "archived";

export const JOB_BUCKET_LIFECYCLES: Record<JobListBucket, readonly JobLifecycle[]> = {
  active: ["draft", "active", "invoiced"],
  finished: ["finished", "canceled"],
  archived: ["archived"],
};

export type JobListQuery = {
  /** Required for S19 customer-scoped list; omitted for S05 workspace list. */
  customer_id: string | null;
  cursor: string | null;
  limit: number;
  search: string | null;
  /** Legacy state filter. Null when `bucket` is set. */
  state: JobListState | null;
  /** S05 Jobs-tab bucket. Null when legacy `state` is set. */
  bucket: JobListBucket | null;
};

const LIST_ALLOWED = new Set(["customer_id", "cursor", "limit", "search", "state", "bucket"]);

function isJobListBucket(value: unknown): value is JobListBucket {
  return value === "active" || value === "finished" || value === "archived";
}

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  fieldErrors: Record<string, string[]>,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      const message = (CREATE_FORBIDDEN_SERVER_FIELDS as readonly string[]).includes(key)
        ? "This field cannot be set by the client."
        : "Unknown field.";
      fieldErrors[key] = [message];
    }
  }
}

export function parseJobTitle(raw: unknown): { value: string; error: string | undefined } {
  return requireBoundedName(raw, JOB_TITLE_MIN, JOB_TITLE_MAX);
}

/**
 * POST /v1/jobs body (CUST-JOB-01 / API.md).
 * Site address is optional only when the owner explicitly sets no_site=true (PRD VAL02).
 * mode is accepted for the create contract / future job_created analytics; document drafts are out of scope.
 */
export function parseCreateJobInput(raw: unknown): CreateJobInput {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ body: ["Request body must be a JSON object."] });
  }
  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  rejectUnknownKeys(body, CREATE_ALLOWED, fieldErrors);

  let id: string | undefined;
  if (body["id"] === undefined || body["id"] === null) {
    fieldErrors["id"] = ["A client UUID is required."];
  } else if (typeof body["id"] !== "string" || !isUuid(body["id"])) {
    fieldErrors["id"] = ["id must be a UUID."];
  } else {
    id = body["id"];
  }

  let customerId: string | undefined;
  if (body["customer_id"] === undefined || body["customer_id"] === null) {
    fieldErrors["customer_id"] = ["customer_id is required."];
  } else if (typeof body["customer_id"] !== "string" || !isUuid(body["customer_id"])) {
    fieldErrors["customer_id"] = ["customer_id must be a UUID."];
  } else {
    customerId = body["customer_id"];
  }

  const title = parseJobTitle(body["title"]);
  if (title.error) {
    fieldErrors["title"] = [title.error];
  }

  let noSite: boolean | undefined;
  if (body["no_site"] === undefined || body["no_site"] === null) {
    fieldErrors["no_site"] = ["no_site is required."];
  } else if (typeof body["no_site"] !== "boolean") {
    fieldErrors["no_site"] = ["no_site must be true or false."];
  } else {
    noSite = body["no_site"];
  }

  let mode: JobMode | undefined;
  if (body["mode"] === undefined || body["mode"] === null) {
    fieldErrors["mode"] = ["mode is required."];
  } else if (body["mode"] !== "quote" && body["mode"] !== "direct_invoice") {
    fieldErrors["mode"] = ["mode must be quote or direct_invoice."];
  } else {
    mode = body["mode"];
  }

  let siteAddress: UsAddress | null = null;
  const hasSiteAddress = Object.prototype.hasOwnProperty.call(body, "site_address");
  if (noSite === true) {
    if (hasSiteAddress && body["site_address"] !== null && body["site_address"] !== undefined) {
      fieldErrors["site_address"] = ["Clear site_address when no_site is true."];
    }
    siteAddress = null;
  } else if (noSite === false) {
    if (!hasSiteAddress || body["site_address"] === null || body["site_address"] === undefined) {
      fieldErrors["site_address"] = ["Enter a site address, or set no_site to true."];
    } else {
      const parsed = parseUsAddress(body["site_address"], "site_address");
      Object.assign(fieldErrors, parsed.fieldErrors);
      if (parsed.value) {
        siteAddress = parsed.value;
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }

  return {
    id: id as string,
    customer_id: customerId as string,
    title: title.value,
    site_address: siteAddress,
    no_site: noSite as boolean,
    mode: mode as JobMode,
  };
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

  let customerId: string | null = null;
  if (body["customer_id"] !== undefined && body["customer_id"] !== null) {
    if (typeof body["customer_id"] !== "string" || !isUuid(body["customer_id"])) {
      fieldErrors["customer_id"] = ["customer_id must be a UUID."];
    } else {
      customerId = body["customer_id"];
    }
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

  const hasState = body["state"] !== undefined && body["state"] !== null;
  const hasBucket = body["bucket"] !== undefined && body["bucket"] !== null;
  if (hasState && hasBucket) {
    fieldErrors["bucket"] = ["Do not supply both bucket and state."];
    fieldErrors["state"] = ["Do not supply both bucket and state."];
  }

  let state: JobListState | null = null;
  let bucket: JobListBucket | null = null;

  if (hasBucket) {
    if (!isJobListBucket(body["bucket"])) {
      fieldErrors["bucket"] = ["Bucket must be active, finished, or archived."];
    } else {
      bucket = body["bucket"];
    }
  } else if (hasState) {
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
  } else if (customerId === null) {
    // S05 general list default (DEC-JOB-001).
    bucket = "active";
  } else {
    // Customer-scoped default remains all (CUST-API-03).
    state = "all";
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }

  return {
    customer_id: customerId,
    cursor,
    limit,
    search,
    state,
    bucket,
  };
}

export function jobMatchesListState(lifecycle: JobLifecycle, state: JobListState): boolean {
  if (state === "all") return true;
  if (state === "active") return lifecycle !== "archived";
  if (state === "archived") return lifecycle === "archived";
  return lifecycle === state;
}

export function jobMatchesListBucket(lifecycle: JobLifecycle, bucket: JobListBucket): boolean {
  return (JOB_BUCKET_LIFECYCLES[bucket] as readonly string[]).includes(lifecycle);
}
