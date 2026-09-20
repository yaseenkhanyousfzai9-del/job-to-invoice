import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeCustomerListCursor,
  encodeCustomerListCursor,
  escapeLikePattern,
} from "./customer-list-cursor.ts";
import { AppError } from "./errors.ts";

test("customer list cursor round-trips and binds filters", () => {
  const encoded = encodeCustomerListCursor({
    updated_at: "2026-09-20T12:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    state: "active",
    search: "Jordan",
  });
  const decoded = decodeCustomerListCursor(encoded, {
    state: "active",
    search: "Jordan",
  });
  assert.equal(decoded.updated_at, "2026-09-20T12:00:00.000Z");
  assert.equal(decoded.id, "11111111-1111-4111-8111-111111111111");
});

test("customer list cursor rejects filter mismatch and malformed payload", () => {
  const encoded = encodeCustomerListCursor({
    updated_at: "2026-09-20T12:00:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
    state: "active",
    search: null,
  });
  assert.throws(
    () => decodeCustomerListCursor(encoded, { state: "archived", search: null }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
  assert.throws(
    () => decodeCustomerListCursor("not-a-cursor", { state: "active", search: null }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED",
  );
});

test("escapeLikePattern escapes wildcard metacharacters", () => {
  assert.equal(escapeLikePattern("100%_off\\"), "100\\%\\_off\\\\");
});
