import { validationFailed } from "./errors.ts";
import type { JobListBucket, JobListState } from "./job.ts";

export type JobListCursorPayload = {
  updated_at: string;
  id: string;
};

type BoundCursor = JobListCursorPayload & {
  customer_id: string | null;
  state: JobListState | null;
  bucket: JobListBucket | null;
  search: string | null;
};

function cursorCustomerKey(customerId: string | null): string {
  return customerId ?? "";
}

function cursorStateKey(state: JobListState | null): string {
  return state ?? "";
}

function cursorBucketKey(bucket: JobListBucket | null): string {
  return bucket ?? "";
}

/** Opaque cursor for GET /v1/jobs bound to customer_id + bucket/state + search. */
export function encodeJobListCursor(input: BoundCursor): string {
  const json = JSON.stringify({
    u: input.updated_at,
    i: input.id,
    c: cursorCustomerKey(input.customer_id),
    s: cursorStateKey(input.state),
    b: cursorBucketKey(input.bucket),
    q: input.search ?? "",
  });
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeJobListCursor(
  raw: string,
  expected: {
    customer_id: string | null;
    state: JobListState | null;
    bucket: JobListBucket | null;
    search: string | null;
  },
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
  const bucket = record["b"];
  const search = record["q"];
  if (typeof updatedAt !== "string" || updatedAt.length === 0) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (typeof id !== "string" || id.length === 0) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (customerId !== cursorCustomerKey(expected.customer_id)) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  if (state !== cursorStateKey(expected.state)) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  // Legacy cursors (pre-bucket) omit `b`; treat missing as "".
  const bucketValue = bucket === undefined ? "" : bucket;
  if (typeof bucketValue !== "string" || bucketValue !== cursorBucketKey(expected.bucket)) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  const expectedSearch = expected.search ?? "";
  if (typeof search !== "string" || search !== expectedSearch) {
    throw validationFailed({ cursor: ["Cursor is invalid."] });
  }
  return { updated_at: updatedAt, id };
}
