import { validationFailed } from "./errors.ts";
import type { JobListState } from "./job.ts";

export type JobListCursorPayload = {
  updated_at: string;
  id: string;
};

type BoundCursor = JobListCursorPayload & {
  customer_id: string;
  state: JobListState;
  search: string | null;
};

/** Opaque cursor for GET /v1/jobs bound to customer_id + filters. */
export function encodeJobListCursor(input: BoundCursor): string {
  const json = JSON.stringify({
    u: input.updated_at,
    i: input.id,
    c: input.customer_id,
    s: input.state,
    q: input.search ?? "",
  });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeJobListCursor(
  raw: string,
  expected: { customer_id: string; state: JobListState; search: string | null },
): JobListCursorPayload {
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
  const customerId = record["c"];
  const state = record["s"];
  const search = record["q"];
  if (typeof updatedAt !== "string" || updatedAt.length === 0) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (typeof id !== "string" || id.length === 0) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (customerId !== expected.customer_id) {
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
