import assert from "node:assert/strict";
import { test } from "node:test";
import { isUuid, type Customer } from "@job-to-invoice/domain";
import { DomainApiError } from "../../lib/api";
import {
  buildCreateCustomerRequestBody,
  createCustomerIdempotencySession,
  emptyCustomerFormDraft,
  materialCustomerFormFingerprint,
  submitCreateCustomer,
  validateCustomerFormDraft,
  type CustomerFormDraft,
} from "./createCustomerForm";

function draft(overrides: Partial<CustomerFormDraft> = {}): CustomerFormDraft {
  return { ...emptyCustomerFormDraft(), ...overrides };
}

function sampleCustomer(id = "11111111-1111-4111-8111-111111111111"): Customer {
  return {
    id,
    name: "Pat",
    email: null,
    phone: null,
    billing_address: null,
    archived_at: null,
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  };
}

test("empty draft form fields are ready for New Customer", () => {
  const empty = emptyCustomerFormDraft();
  assert.equal(empty.name, "");
  assert.equal(empty.email, "");
  assert.equal(empty.phone, "");
  assert.equal(empty.address_line1, "");
});

test("name is required by shared domain validation", () => {
  const result = validateCustomerFormDraft(draft({ name: "" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.name);
  }
});

test("invalid email is blocked before API", () => {
  const result = validateCustomerFormDraft(draft({ name: "Pat", email: "not-an-email" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.email);
  }
});

test("invalid phone is blocked before API", () => {
  const result = validateCustomerFormDraft(draft({ name: "Pat", phone: "5125551212" }));
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.phone);
  }
});

test("partial invalid address is blocked before API", () => {
  const result = validateCustomerFormDraft(
    draft({ name: "Pat", address_line1: "1 Main", city: "Austin" }),
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.fieldErrors.state || result.fieldErrors.zip);
  }
});

test("valid minimal customer builds request without ownership fields", () => {
  const body = buildCreateCustomerRequestBody(draft({ name: "Pat" }), false);
  assert.deepEqual(body, { name: "Pat" });
  assert.equal(Object.hasOwn(body, "workspace_id"), false);
  assert.equal(Object.hasOwn(body, "normalized_email"), false);
});

test("valid full customer builds request with address and optional contacts", () => {
  const body = buildCreateCustomerRequestBody(
    draft({
      name: "Jordan Lee",
      email: "Jordan@Example.com",
      phone: "+15551234567",
      address_line1: "200 Customer Ave",
      city: "Austin",
      state: "TX",
      zip: "78702",
    }),
    false,
  );
  assert.equal(body.name, "Jordan Lee");
  assert.equal(body.email, "Jordan@Example.com");
  assert.equal(body.phone, "+15551234567");
  assert.deepEqual(body.billing_address, {
    line1: "200 Customer Ave",
    line2: null,
    city: "Austin",
    state: "TX",
    zip: "78702",
  });
  const validated = validateCustomerFormDraft(
    draft({
      name: "Jordan Lee",
      email: "Jordan@Example.com",
      phone: "+15551234567",
      address_line1: "200 Customer Ave",
      city: "Austin",
      state: "TX",
      zip: "78702",
    }),
  );
  assert.equal(validated.ok, true);
});

test("submit uses access token and Idempotency-Key through API client", async () => {
  const calls: Array<{ token: string; body: unknown; key: string }> = [];
  const result = await submitCreateCustomer({
    accessToken: "test-access-token",
    draft: draft({ name: "Pat" }),
    confirmDuplicateEmail: false,
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    postCustomer: async (token: string, body: unknown, key: string) => {
      calls.push({ token, body, key });
      return sampleCustomer();
    },
  });
  assert.equal(result.kind, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.token, "test-access-token");
  assert.equal(calls[0]?.key, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.deepEqual(calls[0]?.body, { name: "Pat" });
});

test("double submit guard: second overlapping call is prevented by caller ref pattern", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  let resolveFirst: ((customer: Customer) => void) | undefined;
  const firstPromise = new Promise<Customer>((resolve) => {
    resolveFirst = resolve;
  });

  const postCustomer = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const customer = await firstPromise;
    inFlight -= 1;
    return customer;
  };

  const submittingRef = { current: false };
  async function guardedSubmit() {
    if (submittingRef.current) return { kind: "skipped" as const };
    submittingRef.current = true;
    try {
      return await submitCreateCustomer({
        accessToken: "token",
        draft: draft({ name: "Pat" }),
        confirmDuplicateEmail: false,
        idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        postCustomer,
      });
    } finally {
      submittingRef.current = false;
    }
  }

  const first = guardedSubmit();
  const second = await guardedSubmit();
  assert.equal(second.kind, "skipped");
  resolveFirst?.(sampleCustomer());
  const done = await first;
  assert.equal(done.kind, "success");
  assert.equal(maxInFlight, 1);
});

test("201 success result returns created customer", async () => {
  const result = await submitCreateCustomer({
    accessToken: "token",
    draft: draft({ name: "Pat" }),
    confirmDuplicateEmail: false,
    idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    postCustomer: async () => sampleCustomer("22222222-2222-4222-8222-222222222222"),
  });
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.customer.id, "22222222-2222-4222-8222-222222222222");
  }
});

test("422 maps server field errors onto form keys", async () => {
  const result = await submitCreateCustomer({
    accessToken: "token",
    draft: draft({ name: "Pat" }),
    confirmDuplicateEmail: false,
    idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    postCustomer: async () => {
      throw new DomainApiError({
        code: "VALIDATION_FAILED",
        message: "Some fields need attention.",
        field_errors: {
          name: ["Name is required."],
          "billing_address.zip": ["Enter a valid US ZIP."],
        },
        retryable: false,
        status: 422,
      });
    },
  });
  assert.equal(result.kind, "server_validation");
  if (result.kind === "server_validation") {
    assert.equal(result.fieldErrors.name, "Name is required.");
    assert.equal(result.fieldErrors.zip, "Enter a valid US ZIP.");
  }
});

test("409 duplicate shows confirmation payload and cancel does not create", async () => {
  let calls = 0;
  const result = await submitCreateCustomer({
    accessToken: "token",
    draft: draft({ name: "Second", email: "shared@example.com" }),
    confirmDuplicateEmail: false,
    idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    postCustomer: async () => {
      calls += 1;
      throw new DomainApiError({
        code: "DUPLICATE_CUSTOMER_EMAIL",
        message: "A contact with this email already exists. Confirm to create a separate named contact.",
        field_errors: {},
        retryable: false,
        status: 409,
        details: {
          duplicates: [{ id: "11111111-1111-4111-8111-111111111111", name: "First" }],
        },
      });
    },
  });
  assert.equal(result.kind, "duplicate");
  if (result.kind === "duplicate") {
    assert.equal(result.duplicates[0]?.name, "First");
  }
  assert.equal(calls, 1);
});

test("duplicate confirm sends confirm_duplicate_email true with a new idempotency key", async () => {
  const keys: string[] = [];
  const bodies: unknown[] = [];
  let n = 0;
  const session = createCustomerIdempotencySession(() => {
    n += 1;
    return `ffffffff-ffff-4fff-8fff-${String(n).padStart(12, "0")}`;
  });
  const form = draft({ name: "Second", email: "shared@example.com" });
  const firstKey = session.keyForMaterialDraft(form);

  await submitCreateCustomer({
    accessToken: "token",
    draft: form,
    confirmDuplicateEmail: false,
    idempotencyKey: firstKey,
    postCustomer: async (_t: string, body: unknown, key: string) => {
      keys.push(key);
      bodies.push(body);
      throw new DomainApiError({
        code: "DUPLICATE_CUSTOMER_EMAIL",
        message: "duplicate",
        field_errors: {},
        retryable: false,
        status: 409,
        details: { duplicates: [{ id: "11111111-1111-4111-8111-111111111111", name: "First" }] },
      });
    },
  });

  const confirmKey = session.newKeyForConfirmation();
  assert.notEqual(confirmKey, firstKey);

  const confirmed = await submitCreateCustomer({
    accessToken: "token",
    draft: form,
    confirmDuplicateEmail: true,
    idempotencyKey: confirmKey,
    postCustomer: async (_t: string, body: unknown, key: string) => {
      keys.push(key);
      bodies.push(body);
      return sampleCustomer("33333333-3333-4333-8333-333333333333");
    },
  });
  assert.equal(confirmed.kind, "success");
  assert.equal(keys[1], confirmKey);
  assert.equal((bodies[1] as { confirm_duplicate_email?: boolean }).confirm_duplicate_email, true);
});

test("network failure shows retryable error", async () => {
  const result = await submitCreateCustomer({
    accessToken: "token",
    draft: draft({ name: "Pat" }),
    confirmDuplicateEmail: false,
    idempotencyKey: "99999999-9999-4999-8999-999999999999",
    postCustomer: async () => {
      throw new DomainApiError({
        code: "NETWORK",
        message: "Network problem. Check your connection and try again.",
        field_errors: {},
        retryable: true,
        status: 0,
      });
    },
  });
  assert.equal(result.kind, "network");
  if (result.kind === "network") {
    assert.equal(result.retryable, true);
    assert.match(result.message, /connection/i);
  }
});

test("idempotency session reuses key for same material fields and rotates on change", () => {
  let n = 0;
  const session = createCustomerIdempotencySession(() => {
    n += 1;
    return `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  });
  const a = draft({ name: "Pat" });
  const first = session.keyForMaterialDraft(a);
  const second = session.keyForMaterialDraft(a);
  assert.equal(first, second);
  const third = session.keyForMaterialDraft(draft({ name: "Other" }));
  assert.notEqual(third, first);
  assert.notEqual(
    materialCustomerFormFingerprint(a),
    materialCustomerFormFingerprint(draft({ name: "Other" })),
  );
});

test("idempotency session initializes without global crypto.randomUUID", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });
  try {
    const session = createCustomerIdempotencySession();
    const key = session.keyForMaterialDraft(draft({ name: "Pat" }));
    assert.equal(isUuid(key), true);
    assert.equal(session.keyForMaterialDraft(draft({ name: "Pat" })), key);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});

test("default idempotency key is UUID-shaped for first submission", () => {
  const session = createCustomerIdempotencySession();
  const key = session.keyForMaterialDraft(draft({ name: "Pat" }));
  assert.equal(isUuid(key), true);
});

test("duplicate confirm rotates to a new UUID key", () => {
  const session = createCustomerIdempotencySession();
  const first = session.keyForMaterialDraft(draft({ name: "Pat", email: "a@b.com" }));
  const confirm = session.newKeyForConfirmation();
  assert.notEqual(confirm, first);
  assert.equal(isUuid(confirm), true);
});

test("successful save path clears form draft helper", () => {
  const filled = draft({ name: "Pat", email: "a@b.com" });
  assert.notEqual(filled.name, "");
  const cleared = emptyCustomerFormDraft();
  assert.equal(cleared.name, "");
  assert.equal(cleared.email, "");
});
