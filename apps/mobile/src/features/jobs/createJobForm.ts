import {
  parseCreateJobInput,
  type CreatedJob,
  type JobMode,
} from "@job-to-invoice/domain";
import { DomainApiError, createJob, type CreateJobBody, type CreatedJobDto } from "../../lib/api";
import { createClientUuid } from "../../lib/clientUuid";

export type CreateJobFormDraft = {
  customerId: string | null;
  customerName: string | null;
  title: string;
  noSite: boolean;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  /** PRD S06: Quote or Direct invoice → API mode quote | direct_invoice */
  mode: JobMode;
};

export type CreateJobSubmitResult =
  | { kind: "client_validation"; fieldErrors: Record<string, string>; message: string }
  | { kind: "success"; job: CreatedJobDto }
  | { kind: "customer_archived"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "server_validation"; message: string; fieldErrors: Record<string, string> }
  | { kind: "idempotency_mismatch"; message: string }
  | { kind: "unauthenticated"; message: string }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "error"; message: string; retryable: boolean };

export function emptyCreateJobFormDraft(): CreateJobFormDraft {
  return {
    customerId: null,
    customerName: null,
    title: "",
    noSite: false,
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
    mode: "quote",
  };
}

export function modeLabel(mode: JobMode): string {
  return mode === "quote" ? "Quote" : "Direct invoice";
}

export function materialCreateJobFingerprint(draft: CreateJobFormDraft): string {
  return JSON.stringify({
    customerId: draft.customerId,
    title: draft.title,
    noSite: draft.noSite,
    address_line1: draft.address_line1,
    address_line2: draft.address_line2,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
    mode: draft.mode,
  });
}

export function createJobIdempotencySession(newKey: () => string = createClientUuid) {
  let key = newKey();
  let fingerprint = "";

  return {
    keyForMaterialDraft(draft: CreateJobFormDraft): string {
      const next = materialCreateJobFingerprint(draft);
      if (next !== fingerprint) {
        fingerprint = next;
        key = newKey();
      }
      return key;
    },
    currentKey(): string {
      return key;
    },
    reset(): void {
      key = newKey();
      fingerprint = "";
    },
  };
}

function flattenFieldErrors(fieldErrors: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const first = messages[0];
    if (first) {
      out[key] = first;
    }
  }
  return out;
}

export function buildCreateJobRequestBody(
  draft: CreateJobFormDraft,
  jobId: string,
): { ok: true; body: CreateJobBody } | { ok: false; fieldErrors: Record<string, string>; message: string } {
  if (!draft.customerId) {
    return {
      ok: false,
      fieldErrors: { customer_id: "Select a customer." },
      message: "Select a customer.",
    };
  }

  const raw: Record<string, unknown> = {
    id: jobId,
    customer_id: draft.customerId,
    title: draft.title,
    no_site: draft.noSite,
    mode: draft.mode,
  };

  if (draft.noSite) {
    raw.site_address = null;
  } else {
    raw.site_address = {
      line1: draft.address_line1,
      line2: draft.address_line2.trim().length > 0 ? draft.address_line2 : null,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
    };
  }

  try {
    const parsed = parseCreateJobInput(raw);
    const body: CreateJobBody = {
      id: parsed.id,
      customer_id: parsed.customer_id,
      title: parsed.title,
      site_address: parsed.site_address,
      no_site: parsed.no_site,
      mode: parsed.mode,
    };
    return { ok: true, body };
  } catch (cause) {
    if (cause && typeof cause === "object" && "fieldErrors" in cause) {
      const appError = cause as { message?: string; fieldErrors: Record<string, string[]> };
      return {
        ok: false,
        fieldErrors: flattenFieldErrors(appError.fieldErrors),
        message: appError.message || "Some fields need attention.",
      };
    }
    return {
      ok: false,
      fieldErrors: { body: "Some fields need attention." },
      message: "Some fields need attention.",
    };
  }
}

export async function submitCreateJob(options: {
  accessToken: string | null | undefined;
  draft: CreateJobFormDraft;
  jobId: string;
  idempotencyKey: string;
  postJob?: typeof createJob;
}): Promise<CreateJobSubmitResult> {
  if (!options.accessToken) {
    return { kind: "unauthenticated", message: "Sign in to continue." };
  }

  const built = buildCreateJobRequestBody(options.draft, options.jobId);
  if (!built.ok) {
    return {
      kind: "client_validation",
      fieldErrors: built.fieldErrors,
      message: built.message,
    };
  }

  const post = options.postJob ?? createJob;
  try {
    const job = await post(options.accessToken, built.body, options.idempotencyKey);
    return { kind: "success", job };
  } catch (cause) {
    if (!(cause instanceof DomainApiError)) {
      return {
        kind: "error",
        message: "Couldn’t create job. Try again.",
        retryable: true,
      };
    }
    const api = cause.api;
    if (api.code === "UNAUTHENTICATED" || api.status === 401) {
      return { kind: "unauthenticated", message: api.message || "Sign in to continue." };
    }
    if (api.code === "CUSTOMER_ARCHIVED" || (api.status === 422 && api.code === "CUSTOMER_ARCHIVED")) {
      return {
        kind: "customer_archived",
        message: "This customer is archived and can’t be used for a new job.",
      };
    }
    if (api.status === 404 || api.code === "NOT_FOUND") {
      return {
        kind: "not_found",
        message: "That customer isn’t available. Choose another active customer.",
      };
    }
    if (api.code === "IDEMPOTENCY_MISMATCH") {
      return {
        kind: "idempotency_mismatch",
        message: api.message || "This save conflicted with a previous request. Try again.",
      };
    }
    if (api.code === "NETWORK" || api.status === 0) {
      return {
        kind: "network",
        message: api.message || "Network problem. Check your connection and try again.",
        retryable: true,
      };
    }
    if (api.status === 422 || api.code === "VALIDATION_FAILED") {
      return {
        kind: "server_validation",
        message: api.message || "Some fields need attention.",
        fieldErrors: flattenFieldErrors(api.field_errors),
      };
    }
    return {
      kind: "error",
      message: api.message || "Couldn’t create job.",
      retryable: api.retryable || api.status >= 500,
    };
  }
}

/** Success destination per CUST-JOB-01 evidence: Customer Detail shows the new job. */
export function createJobSuccessDetailParams(customerId: string): {
  pathname: "/(app)/customers/[id]";
  params: { id: string; jobCreated: "1" };
} {
  return {
    pathname: "/(app)/customers/[id]",
    params: { id: customerId, jobCreated: "1" },
  };
}

export type { CreatedJob };
