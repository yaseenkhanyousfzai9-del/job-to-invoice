import assert from "node:assert/strict";
import { test } from "node:test";
import type { Customer } from "@job-to-invoice/domain";
import { DomainApiError } from "../../lib/api";
import { emptyCustomerFormDraft, type CustomerFormDraft } from "./createCustomerForm";
import {
  buildPatchCustomerRequestBody,
  draftFromCustomer,
  parseServerCustomerFromConflict,
  submitEditCustomer,
  validateEditCustomerDraft,
} from "./editCustomerForm";

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Original Name",
    email: "keep@example.com",
    phone: "+15551234567",
    billing_address: {
      line1: "200 Customer Ave",
      line2: null,
      city: "Austin",
      state: "TX",
      zip: "78702",
    },
    archived_at: null,
    version: 3,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

function baselineDraft(): CustomerFormDraft {
  return draftFromCustomer(sampleCustomer());
}

test("form prefills from customer including version fields for If-Match", () => {
  const customer = sampleCustomer({ version: 7, archived_at: "2026-09-21T12:00:00.000Z" });
  const draft = draftFromCustomer(customer);
  assert.equal(draft.name, "Original Name");
  assert.equal(draft.email, "keep@example.com");
  assert.equal(draft.phone, "+15551234567");
  assert.equal(draft.address_line1, "200 Customer Ave");
  assert.equal(draft.city, "Austin");
  assert.equal(draft.state, "TX");
  assert.equal(draft.zip, "78702");
  assert.equal(customer.version, 7);
  assert.ok(customer.archived_at);
});

test("name-only change sends only name", () => {
  const baseline = baselineDraft();
  const draft = { ...baseline, name: "New Name" };
  const body = buildPatchCustomerRequestBody(baseline, draft, false);
  assert.deepEqual(body, { name: "New Name" });
});

test("email-only, phone-only, and billing-address-only patches", () => {
  const baseline = baselineDraft();
  assert.deepEqual(
    buildPatchCustomerRequestBody(baseline, { ...baseline, email: "new@example.com" }, false),
    { email: "new@example.com" },
  );
  assert.deepEqual(
    buildPatchCustomerRequestBody(baseline, { ...baseline, phone: "+15557654321" }, false),
    { phone: "+15557654321" },
  );
  assert.deepEqual(
    buildPatchCustomerRequestBody(
      baseline,
      { ...baseline, zip: "78703" },
      false,
    ),
    {
      billing_address: {
        line1: "200 Customer Ave",
        line2: null,
        city: "Austin",
        state: "TX",
        zip: "78703",
      },
    },
  );
});

test("clearing optional fields sends explicit null", () => {
  const baseline = baselineDraft();
  assert.deepEqual(
    buildPatchCustomerRequestBody(baseline, { ...baseline, email: "" }, false),
    { email: null },
  );
  assert.deepEqual(
    buildPatchCustomerRequestBody(baseline, { ...baseline, phone: "" }, false),
    { phone: null },
  );
  const clearedAddress: CustomerFormDraft = {
    ...baseline,
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
  };
  assert.deepEqual(buildPatchCustomerRequestBody(baseline, clearedAddress, false), {
    billing_address: null,
  });
});

test("unchanged fields omitted; no-changes validation", () => {
  const baseline = baselineDraft();
  assert.deepEqual(buildPatchCustomerRequestBody(baseline, { ...baseline }, false), {});
  const validated = validateEditCustomerDraft(baseline, baseline, false);
  assert.equal("noChanges" in validated && validated.noChanges, true);
});

test("self-email change to same value does not include email in patch", () => {
  const baseline = baselineDraft();
  const body = buildPatchCustomerRequestBody(
    baseline,
    { ...baseline, name: "Renamed", email: "keep@example.com" },
    false,
  );
  assert.deepEqual(body, { name: "Renamed" });
});

test("submit sends If-Match and Idempotency-Key; one call; success updates version", async () => {
  const baseline = baselineDraft();
  const draft = { ...baseline, name: "Patched" };
  let calls = 0;
  const result = await submitEditCustomer({
    accessToken: "token",
    customerId: "11111111-1111-4111-8111-111111111111",
    baseline,
    draft,
    version: 3,
    confirmDuplicateEmail: false,
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    patch: async (token, id, body, options) => {
      calls += 1;
      assert.equal(token, "token");
      assert.equal(id, "11111111-1111-4111-8111-111111111111");
      assert.deepEqual(body, { name: "Patched" });
      assert.equal(options.ifMatch, 3);
      assert.equal(options.idempotencyKey, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      return sampleCustomer({ name: "Patched", version: 4 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.kind, "success");
  if (result.kind === "success") {
    assert.equal(result.customer.version, 4);
  }
});

test("rapid overlapping submits are guarded by caller; submit itself is single-flight ready", async () => {
  const baseline = baselineDraft();
  const draft = { ...baseline, name: "Once" };
  let calls = 0;
  const patch = async () => {
    calls += 1;
    return sampleCustomer({ name: "Once", version: 4 });
  };
  await Promise.all([
    submitEditCustomer({
      accessToken: "token",
      customerId: sampleCustomer().id,
      baseline,
      draft,
      version: 3,
      confirmDuplicateEmail: false,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      patch,
    }),
    submitEditCustomer({
      accessToken: "token",
      customerId: sampleCustomer().id,
      baseline,
      draft,
      version: 3,
      confirmDuplicateEmail: false,
      idempotencyKey: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      patch,
    }),
  ]);
  assert.equal(calls, 2);
});

test("duplicate warning and confirmation with new key semantics", async () => {
  const baseline = baselineDraft();
  const draft = { ...baseline, email: "other@example.com" };
  const warn = await submitEditCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    baseline,
    draft,
    version: 3,
    confirmDuplicateEmail: false,
    idempotencyKey: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    patch: async () => {
      throw new DomainApiError({
        code: "DUPLICATE_CUSTOMER_EMAIL",
        message: "A contact with this email already exists.",
        field_errors: {},
        retryable: false,
        status: 409,
        details: { duplicates: [{ id: "22222222-2222-4222-8222-222222222222", name: "Other" }] },
      });
    },
  });
  assert.equal(warn.kind, "duplicate");
  if (warn.kind === "duplicate") {
    assert.equal(warn.duplicates[0]?.name, "Other");
  }

  let confirmedBody: unknown;
  const confirmed = await submitEditCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    baseline,
    draft,
    version: 3,
    confirmDuplicateEmail: true,
    idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    patch: async (_t, _i, body) => {
      confirmedBody = body;
      return sampleCustomer({ email: "other@example.com", version: 4 });
    },
  });
  assert.equal(confirmed.kind, "success");
  assert.deepEqual(confirmedBody, {
    email: "other@example.com",
    confirm_duplicate_email: true,
  });
});

test("VERSION_CONFLICT returns server customer for reload", async () => {
  const baseline = baselineDraft();
  const draft = { ...baseline, name: "Stale" };
  const server = sampleCustomer({ name: "Server Wins", version: 9 });
  const result = await submitEditCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    baseline,
    draft,
    version: 3,
    confirmDuplicateEmail: false,
    idempotencyKey: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    patch: async () => {
      throw new DomainApiError({
        code: "VERSION_CONFLICT",
        message: "This record changed.",
        field_errors: {},
        retryable: false,
        status: 409,
        details: { server },
      });
    },
  });
  assert.equal(result.kind, "version_conflict");
  if (result.kind === "version_conflict") {
    assert.equal(result.server.name, "Server Wins");
    assert.equal(result.server.version, 9);
    const reloaded = draftFromCustomer(result.server);
    assert.equal(reloaded.name, "Server Wins");
  }
  assert.deepEqual(parseServerCustomerFromConflict({ server }), server);
});

test("network error preserves retryable result without sign-out", async () => {
  const baseline = baselineDraft();
  const draft = { ...baseline, name: "Offline" };
  const result = await submitEditCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    baseline,
    draft,
    version: 3,
    confirmDuplicateEmail: false,
    idempotencyKey: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    patch: async () => {
      throw new DomainApiError({
        code: "NETWORK",
        message: "Network problem.",
        field_errors: {},
        retryable: true,
        status: 0,
      });
    },
  });
  assert.equal(result.kind, "network");
  if (result.kind === "network") {
    assert.equal(result.retryable, true);
  }
});

test("archived customer draft still builds contact patches; archived_at not in body", () => {
  const customer = sampleCustomer({ archived_at: "2026-09-21T12:00:00.000Z" });
  const baseline = draftFromCustomer(customer);
  const body = buildPatchCustomerRequestBody(baseline, { ...baseline, name: "Still Editable" }, false);
  assert.deepEqual(body, { name: "Still Editable" });
  assert.equal("archived_at" in body, false);
});

test("empty draft baseline with no prior address does not send null address", () => {
  const baseline = emptyCustomerFormDraft();
  baseline.name = "Minimal";
  const draft = { ...baseline, name: "Minimal Two" };
  assert.deepEqual(buildPatchCustomerRequestBody(baseline, draft, false), { name: "Minimal Two" });
});
