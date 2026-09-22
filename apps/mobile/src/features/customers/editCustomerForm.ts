import {
  AppError,
  parseUpdateCustomerInput,
  type Customer,
  type DuplicateCustomerMatch,
  type UpdateCustomerInput,
} from "@job-to-invoice/domain";
import { DomainApiError, getCustomer, patchCustomer } from "../../lib/api";
import {
  createCustomerIdempotencySession,
  customerFormHasAddressInput,
  emptyCustomerFormDraft,
  mapServerFieldErrors,
  materialCustomerFormFingerprint,
  type CustomerFormDraft,
} from "./createCustomerForm";

export type EditCustomerSubmitResult =
  | { kind: "client_validation"; fieldErrors: Record<string, string> }
  | { kind: "no_changes"; message: string }
  | { kind: "success"; customer: Customer }
  | {
      kind: "duplicate";
      message: string;
      duplicates: DuplicateCustomerMatch[];
    }
  | {
      kind: "version_conflict";
      message: string;
      server: Customer;
    }
  | { kind: "not_found"; message: string }
  | { kind: "server_validation"; message: string; fieldErrors: Record<string, string> }
  | { kind: "unauthenticated"; message: string }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "error"; message: string; retryable: boolean };

export function draftFromCustomer(customer: Customer): CustomerFormDraft {
  const address = customer.billing_address;
  return {
    name: customer.name,
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    address_line1: address?.line1 ?? "",
    address_line2: address?.line2 ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
    zip: address?.zip ?? "",
  };
}

function normalizeComparableDraft(draft: CustomerFormDraft): CustomerFormDraft {
  return {
    name: draft.name.trim(),
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    address_line1: draft.address_line1.trim(),
    address_line2: draft.address_line2.trim(),
    city: draft.city.trim(),
    state: draft.state.trim().toUpperCase(),
    zip: draft.zip.trim(),
  };
}

function addressPayloadFromDraft(draft: CustomerFormDraft): Record<string, unknown> | null {
  if (!customerFormHasAddressInput(draft)) {
    return null;
  }
  return {
    line1: draft.address_line1,
    line2: draft.address_line2.trim().length > 0 ? draft.address_line2 : null,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
  };
}

/**
 * Minimal PATCH body: only changed fields.
 * Cleared optional fields are explicit null (not omitted).
 */
export function buildPatchCustomerRequestBody(
  baseline: CustomerFormDraft,
  draft: CustomerFormDraft,
  confirmDuplicateEmail: boolean,
): Record<string, unknown> {
  const before = normalizeComparableDraft(baseline);
  const after = normalizeComparableDraft(draft);
  const body: Record<string, unknown> = {};

  if (after.name !== before.name) {
    body.name = draft.name;
  }

  if (after.email !== before.email) {
    body.email = after.email.length > 0 ? draft.email : null;
  }

  if (after.phone !== before.phone) {
    body.phone = after.phone.length > 0 ? draft.phone : null;
  }

  const beforeHadAddress = customerFormHasAddressInput(baseline);
  const afterHasAddress = customerFormHasAddressInput(draft);
  const beforeAddressKey = materialCustomerFormFingerprint({
    ...emptyCustomerFormDraft(),
    address_line1: before.address_line1,
    address_line2: before.address_line2,
    city: before.city,
    state: before.state,
    zip: before.zip,
  });
  const afterAddressKey = materialCustomerFormFingerprint({
    ...emptyCustomerFormDraft(),
    address_line1: after.address_line1,
    address_line2: after.address_line2,
    city: after.city,
    state: after.state,
    zip: after.zip,
  });

  if (!beforeHadAddress && !afterHasAddress) {
    // omit
  } else if (beforeHadAddress && !afterHasAddress) {
    body.billing_address = null;
  } else if (beforeAddressKey !== afterAddressKey) {
    body.billing_address = addressPayloadFromDraft(draft);
  }

  if (confirmDuplicateEmail) {
    body.confirm_duplicate_email = true;
  }

  return body;
}

export function validateEditCustomerDraft(
  draft: CustomerFormDraft,
  baseline: CustomerFormDraft,
  confirmDuplicateEmail: boolean,
):
  | { ok: true; body: Record<string, unknown>; input: UpdateCustomerInput }
  | { ok: false; fieldErrors: Record<string, string> }
  | { ok: false; noChanges: true } {
  const body = buildPatchCustomerRequestBody(baseline, draft, confirmDuplicateEmail);
  const keys = Object.keys(body).filter((key) => key !== "confirm_duplicate_email");
  if (keys.length === 0 && !confirmDuplicateEmail) {
    return { ok: false, noChanges: true };
  }
  // When confirming duplicate, body must still include the email change.
  if (keys.length === 0 && confirmDuplicateEmail) {
    return { ok: false, noChanges: true };
  }

  try {
    const input = parseUpdateCustomerInput(body);
    return { ok: true, body, input };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "VALIDATION_FAILED") {
      return { ok: false, fieldErrors: mapServerFieldErrors(cause.fieldErrors) };
    }
    return { ok: false, fieldErrors: { body: "Some fields need attention." } };
  }
}

function parseDuplicateMatches(details: Record<string, unknown> | undefined): DuplicateCustomerMatch[] {
  const raw = details?.["duplicates"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const matches: DuplicateCustomerMatch[] = [];
  for (const item of raw) {
    if (
      item !== null &&
      typeof item === "object" &&
      typeof (item as { id?: unknown }).id === "string" &&
      typeof (item as { name?: unknown }).name === "string"
    ) {
      matches.push({
        id: (item as { id: string }).id,
        name: (item as { name: string }).name,
      });
    }
  }
  return matches;
}

export function parseServerCustomerFromConflict(
  details: Record<string, unknown> | undefined,
): Customer | null {
  const raw = details?.["server"];
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record["id"] !== "string" || typeof record["name"] !== "string") {
    return null;
  }
  if (typeof record["version"] !== "number") {
    return null;
  }
  return {
    id: record["id"],
    name: record["name"],
    email: typeof record["email"] === "string" ? record["email"] : null,
    phone: typeof record["phone"] === "string" ? record["phone"] : null,
    billing_address:
      record["billing_address"] === null || record["billing_address"] === undefined
        ? null
        : (record["billing_address"] as Customer["billing_address"]),
    archived_at: typeof record["archived_at"] === "string" ? record["archived_at"] : null,
    version: record["version"],
    created_at: typeof record["created_at"] === "string" ? record["created_at"] : "",
    updated_at: typeof record["updated_at"] === "string" ? record["updated_at"] : "",
  };
}

export { createCustomerIdempotencySession };

export async function submitEditCustomer(options: {
  accessToken: string | null | undefined;
  customerId: string;
  baseline: CustomerFormDraft;
  draft: CustomerFormDraft;
  version: number;
  confirmDuplicateEmail: boolean;
  idempotencyKey: string;
  patch?: typeof patchCustomer;
}): Promise<EditCustomerSubmitResult> {
  const validated = validateEditCustomerDraft(
    options.draft,
    options.baseline,
    options.confirmDuplicateEmail,
  );
  if ("noChanges" in validated && validated.noChanges) {
    return { kind: "no_changes", message: "No changes to save." };
  }
  if (!validated.ok) {
    if ("fieldErrors" in validated) {
      return { kind: "client_validation", fieldErrors: validated.fieldErrors };
    }
    return { kind: "no_changes", message: "No changes to save." };
  }
  if (!options.accessToken) {
    return { kind: "unauthenticated", message: "Sign in to continue." };
  }

  const patch = options.patch ?? patchCustomer;

  try {
    const customer = await patch(options.accessToken, options.customerId, validated.body, {
      idempotencyKey: options.idempotencyKey,
      ifMatch: options.version,
    });
    return { kind: "success", customer };
  } catch (cause: unknown) {
    if (!(cause instanceof DomainApiError)) {
      return {
        kind: "network",
        message: "Couldn’t save customer. Check your connection and try again.",
        retryable: true,
      };
    }
    const api = cause.api;
    if (api.code === "DUPLICATE_CUSTOMER_EMAIL") {
      return {
        kind: "duplicate",
        message:
          api.message || "A customer with this email already exists in your workspace.",
        duplicates: parseDuplicateMatches(api.details),
      };
    }
    if (api.code === "VERSION_CONFLICT") {
      const server = parseServerCustomerFromConflict(api.details);
      if (!server) {
        return {
          kind: "error",
          message: "This customer was updated elsewhere. Reload and try again.",
          retryable: false,
        };
      }
      return {
        kind: "version_conflict",
        message: "This customer was updated elsewhere.",
        server,
      };
    }
    if (api.code === "NOT_FOUND" || api.status === 404) {
      return { kind: "not_found", message: api.message || "Customer not found." };
    }
    if (api.code === "VALIDATION_FAILED" || api.status === 422) {
      return {
        kind: "server_validation",
        message: api.message,
        fieldErrors: mapServerFieldErrors(api.field_errors),
      };
    }
    if (api.code === "UNAUTHENTICATED" || api.status === 401) {
      return { kind: "unauthenticated", message: api.message };
    }
    if (api.code === "NETWORK" || api.status === 0) {
      return {
        kind: "network",
        message: "Couldn’t save customer. Check your connection and try again.",
        retryable: true,
      };
    }
    return {
      kind: "error",
      message: api.retryable
        ? "Couldn’t save customer. Check your connection and try again."
        : api.message,
      retryable: api.retryable,
    };
  }
}

/** Load customer for edit when opening without an in-memory baseline. */
export async function loadCustomerForEdit(
  accessToken: string | null | undefined,
  customerId: string,
  fetch: typeof getCustomer = getCustomer,
): Promise<
  | { kind: "success"; customer: Customer }
  | { kind: "unauthenticated"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "error"; message: string; retryable: boolean }
> {
  if (!accessToken) {
    return { kind: "unauthenticated", message: "Sign in to continue." };
  }
  try {
    const customer = await fetch(accessToken, customerId);
    return { kind: "success", customer };
  } catch (cause: unknown) {
    if (!(cause instanceof DomainApiError)) {
      return {
        kind: "network",
        message: "Couldn’t load customer. Check your connection and try again.",
        retryable: true,
      };
    }
    if (cause.api.code === "NOT_FOUND" || cause.api.status === 404) {
      return { kind: "not_found", message: "Customer not found." };
    }
    if (cause.api.code === "UNAUTHENTICATED" || cause.api.status === 401) {
      return { kind: "unauthenticated", message: cause.api.message };
    }
    if (cause.api.code === "NETWORK" || cause.api.status === 0) {
      return {
        kind: "network",
        message: "Couldn’t load customer. Check your connection and try again.",
        retryable: true,
      };
    }
    return {
      kind: "error",
      message: cause.api.message,
      retryable: cause.api.retryable,
    };
  }
}

export const EDIT_FUTURE_DOCS_COPY =
  "Changes apply to future jobs and drafts. Issued quotes and invoices keep the details they already have.";
