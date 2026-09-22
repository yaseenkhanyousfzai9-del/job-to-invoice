import {
  AppError,
  parseCreateCustomerInput,
  type CreateCustomerInput,
  type Customer,
  type DuplicateCustomerMatch,
} from "@job-to-invoice/domain";
import { DomainApiError, createCustomer } from "../../lib/api";
import { createClientUuid } from "../../lib/clientUuid";

export type CustomerFormDraft = {
  name: string;
  email: string;
  phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
};

export type CustomerFormSubmitResult =
  | { kind: "client_validation"; fieldErrors: Record<string, string> }
  | { kind: "success"; customer: Customer }
  | {
      kind: "duplicate";
      message: string;
      duplicates: DuplicateCustomerMatch[];
    }
  | { kind: "server_validation"; message: string; fieldErrors: Record<string, string> }
  | { kind: "unauthenticated"; message: string }
  | { kind: "network"; message: string; retryable: true }
  | { kind: "error"; message: string; retryable: boolean };

export function emptyCustomerFormDraft(): CustomerFormDraft {
  return {
    name: "",
    email: "",
    phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
  };
}

export function customerFormHasAddressInput(draft: CustomerFormDraft): boolean {
  return (
    draft.address_line1.trim().length > 0 ||
    draft.address_line2.trim().length > 0 ||
    draft.city.trim().length > 0 ||
    draft.state.trim().length > 0 ||
    draft.zip.trim().length > 0
  );
}

export function buildCreateCustomerRequestBody(
  draft: CustomerFormDraft,
  confirmDuplicateEmail: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: draft.name,
  };
  if (draft.email.trim().length > 0) {
    body.email = draft.email;
  }
  if (draft.phone.trim().length > 0) {
    body.phone = draft.phone;
  }
  if (customerFormHasAddressInput(draft)) {
    body.billing_address = {
      line1: draft.address_line1,
      line2: draft.address_line2.trim().length > 0 ? draft.address_line2 : null,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
    };
  }
  if (confirmDuplicateEmail) {
    body.confirm_duplicate_email = true;
  }
  return body;
}

export function materialCustomerFormFingerprint(draft: CustomerFormDraft): string {
  return JSON.stringify({
    name: draft.name,
    email: draft.email,
    phone: draft.phone,
    address_line1: draft.address_line1,
    address_line2: draft.address_line2,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
  });
}

export function createCustomerIdempotencySession(newKey: () => string = createClientUuid) {
  let key = newKey();
  let fingerprint = "";

  return {
    keyForMaterialDraft(draft: CustomerFormDraft): string {
      const next = materialCustomerFormFingerprint(draft);
      if (next !== fingerprint) {
        fingerprint = next;
        key = newKey();
      }
      return key;
    },
    newKeyForConfirmation(): string {
      key = newKey();
      return key;
    },
    currentKey(): string {
      return key;
    },
  };
}

export function validateCustomerFormDraft(
  draft: CustomerFormDraft,
  confirmDuplicateEmail = false,
): { ok: true; input: CreateCustomerInput } | { ok: false; fieldErrors: Record<string, string> } {
  try {
    const input = parseCreateCustomerInput(
      buildCreateCustomerRequestBody(draft, confirmDuplicateEmail),
    );
    return { ok: true, input };
  } catch (cause) {
    if (cause instanceof AppError && cause.code === "VALIDATION_FAILED") {
      return { ok: false, fieldErrors: mapServerFieldErrors(cause.fieldErrors) };
    }
    return { ok: false, fieldErrors: { body: "Some fields need attention." } };
  }
}

export function flattenFieldErrors(fieldErrors: Record<string, string[]>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const first = messages[0];
    if (first) {
      flat[key] = first;
    }
  }
  return flat;
}

function mapFormFieldKey(serverKey: string): string {
  if (serverKey.startsWith("billing_address.")) {
    const part = serverKey.slice("billing_address.".length);
    if (part === "line1") return "address_line1";
    if (part === "line2") return "address_line2";
    if (part === "city") return "city";
    if (part === "state") return "state";
    if (part === "zip") return "zip";
  }
  return serverKey;
}

export function mapServerFieldErrors(
  fieldErrors: Record<string, string[]>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const first = messages[0];
    if (!first) continue;
    mapped[mapFormFieldKey(key)] = first;
  }
  return mapped;
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

export async function submitCreateCustomer(options: {
  accessToken: string | null | undefined;
  draft: CustomerFormDraft;
  confirmDuplicateEmail: boolean;
  idempotencyKey: string;
  postCustomer?: typeof createCustomer;
}): Promise<CustomerFormSubmitResult> {
  const validated = validateCustomerFormDraft(options.draft, options.confirmDuplicateEmail);
  if (!validated.ok) {
    return { kind: "client_validation", fieldErrors: validated.fieldErrors };
  }
  if (!options.accessToken) {
    return { kind: "unauthenticated", message: "Sign in to continue." };
  }

  const post = options.postCustomer ?? createCustomer;
  const body = buildCreateCustomerRequestBody(options.draft, options.confirmDuplicateEmail);

  try {
    const customer = await post(options.accessToken, body, options.idempotencyKey);
    return { kind: "success", customer };
  } catch (cause: unknown) {
    if (!(cause instanceof DomainApiError)) {
      return {
        kind: "error",
        message: "Couldn’t save customer. Check your connection and try again.",
        retryable: true,
      };
    }
    const api = cause.api;
    if (api.code === "DUPLICATE_CUSTOMER_EMAIL") {
      return {
        kind: "duplicate",
        message:
          api.message ||
          "A customer with this email already exists in your workspace.",
        duplicates: parseDuplicateMatches(api.details),
      };
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
      message:
        api.retryable
          ? "Couldn’t save customer. Check your connection and try again."
          : api.message,
      retryable: api.retryable,
    };
  }
}
