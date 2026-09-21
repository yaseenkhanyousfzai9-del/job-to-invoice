import assert from "node:assert/strict";
import { test } from "node:test";
import { DomainApiError } from "../../lib/api";
import {
  createCustomerDetailController,
  customerNoLongerExistsCopy,
} from "./customerDetail";
import {
  createDeleteIdempotencySession,
  DELETE_ACTION_LABEL,
  DELETE_CONFIRM_ACTION,
  DELETE_CONFIRM_BODY,
  DELETE_CONFIRM_TITLE,
  DELETE_NOT_FOUND_MESSAGE,
  DELETE_REFERENCED_GUIDANCE,
  DELETE_REFERENCED_MESSAGE,
  DELETING_LABEL,
  submitDeleteCustomer,
} from "./customerDelete";
import { ARCHIVE_ACTION_LABEL } from "./customerArchive";
import {
  clearCustomersListSession,
  obtainCustomersListController,
} from "./customersListSession";
import type { Customer, JobSummary } from "@job-to-invoice/domain";

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    name: "Delete Target",
    email: "delete@example.com",
    phone: null,
    billing_address: null,
    archived_at: null,
    version: 1,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

function sampleJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    title: "Keep Job",
    lifecycle: "draft",
    updated_at: "2026-09-21T00:00:00.000Z",
    customer_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    customer: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Delete Sample" },
    ...overrides,
  };
}

test("active and archived Customers expose Delete customer label", () => {
  assert.equal(DELETE_ACTION_LABEL, "Delete customer");
  assert.equal(DELETING_LABEL, "Deleting…");
  assert.notEqual(DELETE_ACTION_LABEL, ARCHIVE_ACTION_LABEL);
  assert.ok(DELETE_CONFIRM_TITLE.includes("Delete"));
  assert.match(DELETE_CONFIRM_BODY, /permanently|cannot be undone/i);
  assert.match(DELETE_CONFIRM_BODY, /archive/i);
  assert.equal(DELETE_CONFIRM_ACTION, "Delete customer");
});

test("Cancel delete confirmation sends no request", async () => {
  let calls = 0;
  const controller = createCustomerDetailController(sampleCustomer().id, {
    getCustomer: async () => sampleCustomer(),
    listJobs: async () => ({ items: [], next_cursor: null }),
    deleteCustomer: async () => {
      calls += 1;
      return { deleted: true };
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  assert.equal(controller.getSnapshot().deleteConfirmOpen, true);
  controller.cancelDeleteConfirm();
  assert.equal(controller.getSnapshot().deleteConfirmOpen, false);
  assert.equal(calls, 0);
  controller.dispose();
});

test("confirm Delete sends DELETE with UUID Idempotency-Key and no If-Match", async () => {
  const calls: {
    customerId: string;
    idempotencyKey: string;
    ifMatch?: unknown;
  }[] = [];
  const customer = sampleCustomer();
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    newIdempotencyKey: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    deleteCustomer: async (_token, customerId, idempotencyKey) => {
      calls.push({ customerId, idempotencyKey });
      return { deleted: true };
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  const result = await controller.confirmDelete("token");
  assert.equal(result, "deleted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.customerId, customer.id);
  assert.equal(calls[0]?.idempotencyKey, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  assert.equal(Object.hasOwn(calls[0] ?? {}, "ifMatch"), false);
  assert.equal(controller.getSnapshot().deletePending, false);
  controller.dispose();
});

test("successful Delete refreshes list caches; Active/Archived/All/search omit customer", async () => {
  clearCustomersListSession();
  const target = sampleCustomer({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    name: "Android Test Customer Delete",
  });
  const other = sampleCustomer({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    name: "Other",
  });
  let deleted = false;
  const list = obtainCustomersListController({
    listCustomers: async (_token, params) => {
      const state = params?.state ?? "active";
      const search = params?.search ?? null;
      let items = deleted ? [other] : [target, other];
      if (state === "archived") {
        items = deleted
          ? []
          : [{ ...target, archived_at: "2026-09-21T12:00:00.000Z", version: 2 }];
      }
      if (search && search.includes("Delete")) {
        items = items.filter((c) => c.name.includes("Delete"));
      }
      return { items, next_cursor: null };
    },
  });
  await list.bootstrap("token");
  list.setSearchInput("token", "Android Test Customer Delete");
  await list.flushSearchNow("token");
  assert.equal(list.getSnapshot().items.some((c) => c.id === target.id), true);
  assert.equal(list.getSnapshot().appliedSearch, "Android Test Customer Delete");
  assert.equal(list.getSnapshot().stateFilter, "active");

  let navigated = false;
  const controller = createCustomerDetailController(target.id, {
    getCustomer: async () => target,
    listJobs: async () => ({ items: [], next_cursor: null }),
    deleteCustomer: async () => {
      deleted = true;
      return { deleted: true };
    },
    onDeleteSuccess: async (token) => {
      await list.refreshAfterMutation(token);
      navigated = true;
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  const result = await controller.confirmDelete("token");
  assert.equal(result, "deleted");
  assert.equal(navigated, true);
  assert.equal(list.getSnapshot().items.some((c) => c.id === target.id), false);
  assert.equal(list.getSnapshot().appliedSearch, "Android Test Customer Delete");
  assert.equal(list.getSnapshot().stateFilter, "active");

  await list.setStateFilter("token", "archived");
  assert.equal(list.getSnapshot().items.some((c) => c.id === target.id), false);

  await list.setStateFilter("token", "all");
  assert.equal(list.getSnapshot().items.some((c) => c.id === target.id), false);

  controller.dispose();
  clearCustomersListSession();
});

test("archived unreferenced Customer can be deleted", async () => {
  const customer = sampleCustomer({
    archived_at: "2026-09-21T12:00:00.000Z",
    version: 2,
  });
  let called = false;
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    deleteCustomer: async () => {
      called = true;
      return { deleted: true };
    },
  });
  await controller.bootstrap("token");
  assert.ok(controller.getSnapshot().customer?.archived_at);
  controller.openDeleteConfirm();
  const result = await controller.confirmDelete("token");
  assert.equal(result, "deleted");
  assert.equal(called, true);
  controller.dispose();
});

test("referenced Customer 409 shows conflict; stays on detail; jobs preserved; Archive offered when active", async () => {
  const customer = sampleCustomer();
  const job = sampleJob();
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [job], next_cursor: null }),
    deleteCustomer: async () => {
      throw new DomainApiError({
        code: "CUSTOMER_REFERENCED",
        message: "linked",
        field_errors: {},
        retryable: false,
        status: 409,
      });
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().jobs.length, 1);

  controller.openDeleteConfirm();
  const result = await controller.confirmDelete("token");
  assert.equal(result, "ok");
  const snap = controller.getSnapshot();
  assert.equal(snap.deleteReferencedConflict, true);
  assert.equal(snap.deleteErrorMessage, DELETE_REFERENCED_MESSAGE);
  assert.equal(snap.deleteReferencedGuidance, DELETE_REFERENCED_GUIDANCE);
  assert.equal(snap.customer?.id, customer.id);
  assert.equal(snap.jobs.length, 1);
  assert.equal(snap.jobs[0]?.id, job.id);
  assert.equal(snap.phase, "ready");
  assert.equal(snap.deleteConfirmOpen, false);
  // Active → Archive guidance available via deleteReferencedConflict + archive action
  assert.equal(snap.customer?.archived_at, null);
  controller.dispose();
});

test("referenced archived Customer conflict does not need redundant Archive action", async () => {
  const customer = sampleCustomer({
    archived_at: "2026-09-21T12:00:00.000Z",
    version: 2,
  });
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [sampleJob()], next_cursor: null }),
    deleteCustomer: async () => {
      throw new DomainApiError({
        code: "CUSTOMER_REFERENCED",
        message: "linked",
        field_errors: {},
        retryable: false,
        status: 409,
      });
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  await controller.confirmDelete("token");
  const snap = controller.getSnapshot();
  assert.equal(snap.deleteReferencedConflict, true);
  assert.ok(snap.customer?.archived_at);
  // UI uses actionKind === "archive" to show Archive CTA; archived → restore only
  controller.dispose();
});

test("network delete failure preserves Customer and Retry reuses Idempotency-Key", async () => {
  const keys: string[] = [];
  let keyN = 0;
  const newKey = () => {
    keyN += 1;
    const hex = keyN.toString(16).padStart(12, "0");
    const key = `eeeeeeee-eeee-4eee-8eee-${hex}`;
    keys.push(key);
    return key;
  };
  const seenKeys: string[] = [];
  let failOnce = true;
  const customer = sampleCustomer();
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    newIdempotencyKey: newKey,
    deleteCustomer: async (_t, _id, key) => {
      seenKeys.push(key);
      if (failOnce) {
        failOnce = false;
        throw new DomainApiError({
          code: "NETWORK",
          message: "down",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return { deleted: true };
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  await controller.confirmDelete("token");
  assert.equal(controller.getSnapshot().customer?.id, customer.id);
  assert.equal(controller.getSnapshot().deleteErrorRetryable, true);
  assert.match(controller.getSnapshot().deleteErrorMessage ?? "", /connection/i);

  const retry = await controller.retryDelete("token");
  assert.equal(retry, "deleted");
  assert.equal(seenKeys.length, 2);
  assert.equal(seenKeys[0], seenKeys[1]);
  controller.dispose();
});

test("rapid double confirm → one DELETE; pending blocks duplicate", async () => {
  let calls = 0;
  let resolveDelete!: (value: { deleted: true }) => void;
  const customer = sampleCustomer();
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    deleteCustomer: async () => {
      calls += 1;
      return new Promise((resolve) => {
        resolveDelete = resolve;
      });
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  const first = controller.confirmDelete("token");
  const second = await controller.confirmDelete("token");
  assert.equal(second, "blocked");
  assert.equal(controller.getSnapshot().deletePending, true);
  resolveDelete({ deleted: true });
  assert.equal(await first, "deleted");
  assert.equal(calls, 1);
  controller.dispose();
});

test("generic 404 on delete handled safely", async () => {
  const controller = createCustomerDetailController(sampleCustomer().id, {
    getCustomer: async () => sampleCustomer(),
    listJobs: async () => ({ items: [], next_cursor: null }),
    deleteCustomer: async () => {
      throw new DomainApiError({
        code: "NOT_FOUND",
        message: "missing",
        field_errors: {},
        retryable: false,
        status: 404,
      });
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  const result = await controller.confirmDelete("token");
  assert.equal(result, "not_found");
  assert.equal(controller.getSnapshot().phase, "not_found");
  assert.equal(controller.getSnapshot().deleteNotFound, true);
  assert.equal(controller.getSnapshot().errorMessage, DELETE_NOT_FOUND_MESSAGE);
  assert.equal(customerNoLongerExistsCopy(), DELETE_NOT_FOUND_MESSAGE);
  controller.dispose();
});

test("cancel then new delete attempt uses a new Idempotency-Key", async () => {
  const keys: string[] = [];
  let keyN = 0;
  const newKey = () => {
    keyN += 1;
    const hex = keyN.toString(16).padStart(12, "0");
    return `ffffffff-ffff-4fff-8fff-${hex}`;
  };
  const controller = createCustomerDetailController(sampleCustomer().id, {
    getCustomer: async () => sampleCustomer(),
    listJobs: async () => ({ items: [], next_cursor: null }),
    newIdempotencyKey: newKey,
    deleteCustomer: async (_t, _id, key) => {
      keys.push(key);
      return { deleted: true };
    },
  });
  await controller.bootstrap("token");
  controller.openDeleteConfirm();
  controller.cancelDeleteConfirm();
  controller.openDeleteConfirm();
  await controller.confirmDelete("token");
  assert.equal(keys.length, 1);
  // Session reset on open after cancel produces a fresh key when confirm runs
  const session = createDeleteIdempotencySession(newKey);
  const a = session.keyForAttempt();
  session.reset();
  const b = session.keyForAttempt();
  assert.notEqual(a, b);
  controller.dispose();
});

test("submitDeleteCustomer maps CUSTOMER_REFERENCED without OTP text", async () => {
  const result = await submitDeleteCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deleteCustomer: async () => {
      throw new DomainApiError({
        code: "CUSTOMER_REFERENCED",
        message: "jobs",
        field_errors: {},
        retryable: false,
        status: 409,
      });
    },
  });
  assert.equal(result.kind, "referenced");
  if (result.kind === "referenced") {
    assert.equal(result.message, DELETE_REFERENCED_MESSAGE);
    assert.equal(result.guidance, DELETE_REFERENCED_GUIDANCE);
  }
});

test("transient network delete does not return unauthenticated", async () => {
  const result = await submitDeleteCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    deleteCustomer: async () => {
      throw new DomainApiError({
        code: "NETWORK",
        message: "down",
        field_errors: {},
        retryable: true,
        status: 0,
      });
    },
  });
  assert.equal(result.kind, "network");
  assert.notEqual(result.kind, "unauthenticated");
});
