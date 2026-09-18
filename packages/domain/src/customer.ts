import { parseOptionalBillingAddress, type UsAddress } from "./address.ts";
import { validateOptionalEmail } from "./email.ts";
import { conflict, validationFailed } from "./errors.ts";
import { validateOptionalE164 } from "./phone.ts";
import { requireBoundedName } from "./text.ts";

export type CustomerId = string;

export type BillingAddress = UsAddress;

export type Customer = {
  id: CustomerId;
  name: string;
  email: string | null;
  phone: string | null;
  billing_address: BillingAddress | null;
  archived_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

/**
 * Persistence representation. `workspace_id` is assigned from verified membership.
 * It is never a client authorization input.
 */
export type CustomerRecord = Customer & {
  workspace_id: string;
  normalized_email: string | null;
  created_by: string;
};

export type CreateCustomerInput = {
  name: string;
  email: string | null;
  normalized_email: string | null;
  phone: string | null;
  billing_address: BillingAddress | null;
  confirm_duplicate_email: boolean;
};

export type UpdateCustomerInput = {
  name: string | undefined;
  email: string | null | undefined;
  normalized_email: string | null | undefined;
  phone: string | null | undefined;
  billing_address: BillingAddress | null | undefined;
  confirm_duplicate_email: boolean;
};

export type CustomerListState = "active" | "archived" | "all";

export type CustomerListQuery = {
  search: string | null;
  cursor: string | null;
  limit: number;
  state: CustomerListState;
};

export type CustomerArchiveCommand = {
  archived: boolean;
};

export type DuplicateCustomerMatch = {
  id: CustomerId;
  name: string;
};

export type DuplicateCustomerEmailWarning = {
  duplicates: DuplicateCustomerMatch[];
};

export const CUSTOMER_NAME_MIN = 1;
export const CUSTOMER_NAME_MAX = 120;
export const CUSTOMER_LIST_DEFAULT_LIMIT = 25;
export const CUSTOMER_LIST_MAX_LIMIT = 100;
export const DUPLICATE_CUSTOMER_EMAIL = "DUPLICATE_CUSTOMER_EMAIL";

const CREATE_ALLOWED = new Set([
  "name",
  "email",
  "phone",
  "billing_address",
  "confirm_duplicate_email",
]);

const UPDATE_ALLOWED = new Set([
  "name",
  "email",
  "phone",
  "billing_address",
  "confirm_duplicate_email",
]);

const LIST_ALLOWED = new Set(["search", "cursor", "limit", "state"]);

const ARCHIVE_ALLOWED = new Set(["archived"]);

const FORBIDDEN_OWNERSHIP_FIELDS = [
  "workspace_id",
  "id",
  "archived_at",
  "version",
  "created_at",
  "updated_at",
  "normalized_email",
  "created_by",
] as const;

function rejectUnknownKeys(
  body: Record<string, unknown>,
  allowed: Set<string>,
  fieldErrors: Record<string, string[]>,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      const message = (FORBIDDEN_OWNERSHIP_FIELDS as readonly string[]).includes(key)
        ? "This field cannot be set by the client."
        : "Unknown field.";
      fieldErrors[key] = [message];
    }
  }
}

function parseConfirmFlag(raw: unknown, fieldErrors: Record<string, string[]>): boolean {
  if (raw === undefined) {
    return false;
  }
  if (typeof raw !== "boolean") {
    fieldErrors["confirm_duplicate_email"] = ["Must be true or false."];
    return false;
  }
  return raw;
}

export function parseCustomerName(raw: unknown): { value: string; error: string | undefined } {
  return requireBoundedName(raw, CUSTOMER_NAME_MIN, CUSTOMER_NAME_MAX);
}

export function parseCreateCustomerInput(raw: unknown): CreateCustomerInput {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ body: ["Request body must be a JSON object."] });
  }
  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  rejectUnknownKeys(body, CREATE_ALLOWED, fieldErrors);

  const name = parseCustomerName(body["name"]);
  const email = validateOptionalEmail(body["email"]);
  const phone = validateOptionalE164(body["phone"]);
  const address = parseOptionalBillingAddress(body["billing_address"]);
  const confirm = parseConfirmFlag(body["confirm_duplicate_email"], fieldErrors);

  if (name.error) fieldErrors["name"] = [name.error];
  if (email.error) fieldErrors["email"] = [email.error];
  if (phone.error) fieldErrors["phone"] = [phone.error];
  Object.assign(fieldErrors, address.fieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }

  return {
    name: name.value,
    email: email.display,
    normalized_email: email.normalized,
    phone: phone.value,
    billing_address: address.value,
    confirm_duplicate_email: confirm,
  };
}

export function parseUpdateCustomerInput(raw: unknown): UpdateCustomerInput {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ body: ["Request body must be a JSON object."] });
  }
  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  rejectUnknownKeys(body, UPDATE_ALLOWED, fieldErrors);

  const hasName = Object.prototype.hasOwnProperty.call(body, "name");
  const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
  const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
  const hasAddress = Object.prototype.hasOwnProperty.call(body, "billing_address");

  if (!hasName && !hasEmail && !hasPhone && !hasAddress) {
    fieldErrors["body"] = ["At least one contact field is required."];
  }

  let name: string | undefined;
  if (hasName) {
    const parsed = parseCustomerName(body["name"]);
    if (parsed.error) fieldErrors["name"] = [parsed.error];
    else name = parsed.value;
  }

  let email: string | null | undefined;
  let normalizedEmail: string | null | undefined;
  if (hasEmail) {
    const parsed = validateOptionalEmail(body["email"]);
    if (parsed.error) fieldErrors["email"] = [parsed.error];
    else {
      email = parsed.display;
      normalizedEmail = parsed.normalized;
    }
  }

  let phone: string | null | undefined;
  if (hasPhone) {
    const parsed = validateOptionalE164(body["phone"]);
    if (parsed.error) fieldErrors["phone"] = [parsed.error];
    else phone = parsed.value;
  }

  let billingAddress: BillingAddress | null | undefined;
  if (hasAddress) {
    const parsed = parseOptionalBillingAddress(body["billing_address"]);
    Object.assign(fieldErrors, parsed.fieldErrors);
    if (!parsed.fieldErrors || Object.keys(parsed.fieldErrors).length === 0) {
      billingAddress = parsed.value;
    }
  }

  const confirm = parseConfirmFlag(body["confirm_duplicate_email"], fieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }

  return {
    name,
    email,
    normalized_email: normalizedEmail,
    phone,
    billing_address: billingAddress,
    confirm_duplicate_email: confirm,
  };
}

export function parseCustomerListQuery(raw: unknown): CustomerListQuery {
  if (raw === null || raw === undefined) {
    return {
      search: null,
      cursor: null,
      limit: CUSTOMER_LIST_DEFAULT_LIMIT,
      state: "active",
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ query: ["Invalid list query."] });
  }
  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  rejectUnknownKeys(body, LIST_ALLOWED, fieldErrors);

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

  let state: CustomerListState = "active";
  if (body["state"] !== undefined && body["state"] !== null) {
    if (body["state"] !== "active" && body["state"] !== "archived" && body["state"] !== "all") {
      fieldErrors["state"] = ["State must be active, archived, or all."];
    } else {
      state = body["state"];
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }

  return { search, cursor, limit, state };
}

export function parseCustomerArchiveCommand(raw: unknown): CustomerArchiveCommand {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ body: ["Request body must be a JSON object."] });
  }
  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};
  rejectUnknownKeys(body, ARCHIVE_ALLOWED, fieldErrors);
  if (typeof body["archived"] !== "boolean") {
    fieldErrors["archived"] = ["archived must be true or false."];
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw validationFailed(fieldErrors);
  }
  return { archived: body["archived"] as boolean };
}

export function isCustomerArchived(archivedAt: string | null): boolean {
  return archivedAt !== null;
}

export function nextArchivedAt(
  current: string | null,
  archived: boolean,
  nowIso: string,
): string | null {
  if (!archived) {
    return null;
  }
  return current ?? nowIso;
}

export function duplicateCustomerEmailConflict(
  duplicates: DuplicateCustomerMatch[],
): ReturnType<typeof conflict> {
  return conflict(
    DUPLICATE_CUSTOMER_EMAIL,
    "A contact with this email already exists. Confirm to create a separate named contact.",
    {},
    duplicateEmailWarning(duplicates) as unknown as Record<string, unknown>,
  );
}

export function duplicateEmailWarning(
  duplicates: DuplicateCustomerMatch[],
): DuplicateCustomerEmailWarning {
  return {
    duplicates: duplicates.map((item) => ({ id: item.id, name: item.name })),
  };
}
