import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeJobListCursor, decodeJobListCursor } from "./job-list-cursor.ts";
import { parseJobListQuery } from "./job.ts";

test("job list cursor round-trips and binds customer filter", () => {
  const encoded = encodeJobListCursor({
    updated_at: "2026-09-20T00:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    state: "all",
    search: null,
  });
  const decoded = decodeJobListCursor(encoded, {
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    state: "all",
    search: null,
  });
  assert.equal(decoded.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("job list cursor rejects filter mismatch", () => {
  const encoded = encodeJobListCursor({
    updated_at: "2026-09-20T00:00:00.000Z",
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    state: "all",
    search: null,
  });
  assert.throws(() =>
    decodeJobListCursor(encoded, {
      customer_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      state: "all",
      search: null,
    }),
  );
});

test("parseJobListQuery requires customer_id UUID and defaults state to all", () => {
  const parsed = parseJobListQuery({
    customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  });
  assert.equal(parsed.customer_id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(parsed.state, "all");
  assert.equal(parsed.limit, 25);
  assert.throws(() => parseJobListQuery({}));
  assert.throws(() => parseJobListQuery({ customer_id: "not-a-uuid" }));
  assert.throws(() => parseJobListQuery({ customer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", workspace_id: "w" }));
});
