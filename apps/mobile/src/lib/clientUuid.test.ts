import assert from "node:assert/strict";
import { test } from "node:test";
import { isUuid } from "@job-to-invoice/domain";
import { createClientUuid } from "./clientUuid";

test("createClientUuid returns a domain-valid UUID", () => {
  const value = createClientUuid();
  assert.equal(isUuid(value), true);
});

test("createClientUuid works when crypto.randomUUID is missing", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });
  try {
    const value = createClientUuid();
    assert.equal(isUuid(value), true);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});

test("createClientUuid works when randomUUID throws", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID() {
        throw new Error("unavailable");
      },
      getRandomValues(target: Uint8Array) {
        for (let i = 0; i < target.length; i += 1) {
          target[i] = i;
        }
        return target;
      },
    },
  });
  try {
    const value = createClientUuid();
    assert.equal(isUuid(value), true);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});
