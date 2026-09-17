import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "./app.ts";

test("GET /health returns ok without secrets", async () => {
  const app = await buildApp();
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  assert.equal(response.json().status, "ok");
  assert.ok(response.headers["x-request-id"]);
  await app.close();
});
