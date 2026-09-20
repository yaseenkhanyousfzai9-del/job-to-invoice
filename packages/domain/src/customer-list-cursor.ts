import { validationFailed } from "./errors.ts";
import type { CustomerListState } from "./customer.ts";

export type CustomerListCursorPayload = {
  updated_at: string;
  id: string;
};

type BoundCursor = CustomerListCursorPayload & {
  state: CustomerListState;
  search: string | null;
};

/**
 * Opaque cursor for GET /v1/customers.
 * Bound to state+search so filter changes cannot silently continue another scan.
 */
export function encodeCustomerListCursor(input: BoundCursor): string {
  const json = JSON.stringify({
    u: input.updated_at,
    i: input.id,
    s: input.state,
    q: input.search ?? "",
  });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCustomerListCursor(
  raw: string,
  expected: { state: CustomerListState; search: string | null },
): CustomerListCursorPayload {
  let parsed: unknown;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    parsed = JSON.parse(json);
  } catch {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  const record = parsed as Record<string, unknown>;
  const updatedAt = record["u"];
  const id = record["i"];
  const state = record["s"];
  const search = record["q"];
  if (typeof updatedAt !== "string" || updatedAt.length === 0) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (typeof id !== "string" || id.length === 0) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (state !== expected.state) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  const expectedSearch = expected.search ?? "";
  if (typeof search !== "string" || search !== expectedSearch) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  return { updated_at: updatedAt, id };
}

/** Escape LIKE/ILIKE metacharacters so user search cannot inject wildcards. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
