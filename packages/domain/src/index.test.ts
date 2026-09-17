import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError, createRequestId } from "./index.ts";

test("AppError preserves code and retryable flag", () => {
  const error = new AppError("VALIDATION_FAILED", "Invalid field", false);
  assert.equal(error.name, "AppError");
  assert.equal(error.code, "VALIDATION_FAILED");
  assert.equal(error.message, "Invalid field");
  assert.equal(error.retryable, false);
});

test("createRequestId returns a UUID string", () => {
  const id = createRequestId();
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});
