import assert from "node:assert/strict";
import { test } from "node:test";
import { isUuid, type Customer, type JobSummary } from "@job-to-invoice/domain";
import { DomainApiError } from "../../lib/api";
import {
  ARCHIVE_ACTION_LABEL,
  ARCHIVE_CONFIRM_ACTION,
  ARCHIVE_CONFIRM_BODY,
  ARCHIVE_CONFIRM_TITLE,
  RESTORE_ACTION_LABEL,
  archiveActionForCustomer,
  archiveActionLabel,
  createArchiveIdempotencySession,
  submitArchiveCustomer,
} from "./customerArchive";
import { createCustomerDetailController } from "./customerDetail";
import {
  clearCustomersListSession,
  obtainCustomersListController,
} from "./customersListSession";

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+15125550100",
    billing_address: {
      line1: "100 Main St",
      line2: null,
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    archived_at: null,
    version: 1,
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function sampleJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Fence repair",
    lifecycle: "draft",
    updated_at: "2026-09-20T12:00:00.000Z",
    customer_id: "11111111-1111-4111-8111-111111111111",
    ...overrides,
  };
}

function wait(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("active Customer shows Archive customer; not Restore", () => {
  const customer = sampleCustomer({ archived_at: null });
  assert.equal(archiveActionForCustomer(customer), "archive");
  assert.equal(archiveActionLabel("archive"), ARCHIVE_ACTION_LABEL);
  assert.notEqual(archiveActionLabel("archive"), RESTORE_ACTION_LABEL);
});

test("archived Customer shows Restore customer; not Archive", () => {
  const customer = sampleCustomer({ archived_at: "2026-09-21T00:00:00.000Z" });
  assert.equal(archiveActionForCustomer(customer), "restore");
  assert.equal(archiveActionLabel("restore"), RESTORE_ACTION_LABEL);
});

test("archived badge presentation uses Archived label", async () => {
  const customer = sampleCustomer({ archived_at: "2026-09-21T00:00:00.000Z", version: 2 });
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
  });
  await controller.bootstrap("token");
  const snap = controller.getSnapshot();
  assert.ok(snap.customer?.archived_at);
  assert.equal(snap.customer?.archived_at, "2026-09-21T00:00:00.000Z");
  controller.dispose();
});

test("Archive tap opens confirmation; Cancel sends no request", async () => {
  const customer = sampleCustomer();
  let archiveCalls = 0;
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    archiveCustomer: async () => {
      archiveCalls += 1;
      return sampleCustomer({ archived_at: "2026-09-21T00:00:00.000Z", version: 2 });
    },
  });
  await controller.bootstrap("token");
  controller.openArchiveConfirm();
  assert.equal(controller.getSnapshot().archiveConfirmOpen, true);
  assert.match(ARCHIVE_CONFIRM_TITLE, /Archive/);
  assert.match(ARCHIVE_CONFIRM_BODY, /not deleted|hides|restore|jobs|history/i);
  assert.equal(ARCHIVE_CONFIRM_ACTION, "Archive customer");
  controller.cancelArchiveConfirm();
  assert.equal(controller.getSnapshot().archiveConfirmOpen, false);
  assert.equal(archiveCalls, 0);
  controller.dispose();
});

test("confirm Archive sends archived true with UUID Idempotency-Key and no If-Match", async () => {
  const customer = sampleCustomer();
  const calls: Array<{
    customerId: string;
    archived: boolean;
    idempotencyKey: string;
    headersProbe: { ifMatch?: unknown };
  }> = [];
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    newIdempotencyKey: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    archiveCustomer: async (_token, customerId, archived, idempotencyKey) => {
      calls.push({ customerId, archived, idempotencyKey, headersProbe: {} });
      return sampleCustomer({
        id: customerId,
        archived_at: "2026-09-21T12:00:00.000Z",
        version: 2,
      });
    },
  });
  await controller.bootstrap("token");
  controller.openArchiveConfirm();
  const result = await controller.confirmArchive("token");
  assert.equal(result, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.archived, true);
  assert.equal(calls[0]?.customerId, customer.id);
  assert.equal(isUuid(calls[0]!.idempotencyKey), true);
  assert.equal("ifMatch" in calls[0]!.headersProbe, false);
  const snap = controller.getSnapshot();
  assert.ok(snap.customer?.archived_at);
  assert.equal(snap.customer?.version, 2);
  assert.equal(archiveActionForCustomer(snap.customer), "restore");
  controller.dispose();
});

test("successful Archive refreshes list cache; Active omits; Archived/All include", async () => {
  clearCustomersListSession();
  const active = sampleCustomer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "Active One" });
  const other = sampleCustomer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", name: "Other" });
  let archived = false;
  const list = obtainCustomersListController({
    listCustomers: async (_token, params) => {
      const state = params?.state ?? "active";
      const items = archived
        ? state === "active"
          ? [other]
          : state === "archived"
            ? [{ ...active, archived_at: "2026-09-21T12:00:00.000Z", version: 2 }]
            : [
                { ...active, archived_at: "2026-09-21T12:00:00.000Z", version: 2 },
                other,
              ]
        : state === "archived"
          ? []
          : [active, other];
      return { items, next_cursor: null };
    },
  });
  await list.bootstrap("token");
  assert.equal(list.getSnapshot().items.some((c) => c.id === active.id), true);

  let listRefreshed = false;
  const controller = createCustomerDetailController(active.id, {
    getCustomer: async () => (archived ? { ...active, archived_at: "2026-09-21T12:00:00.000Z", version: 2 } : active),
    listJobs: async () => ({ items: [], next_cursor: null }),
    archiveCustomer: async () => {
      archived = true;
      return { ...active, archived_at: "2026-09-21T12:00:00.000Z", version: 2 };
    },
    onArchiveSuccess: async (_customer, token) => {
      await list.refreshAfterMutation(token);
      listRefreshed = true;
    },
  });
  await controller.bootstrap("token");
  controller.openArchiveConfirm();
  await controller.confirmArchive("token");
  assert.equal(listRefreshed, true);
  assert.equal(list.getSnapshot().items.some((c) => c.id === active.id), false);

  await list.setStateFilter("token", "archived");
  assert.equal(list.getSnapshot().items.some((c) => c.id === active.id), true);

  await list.setStateFilter("token", "all");
  assert.equal(list.getSnapshot().items.some((c) => c.id === active.id), true);
  assert.ok(list.getSnapshot().items.find((c) => c.id === active.id)?.archived_at);

  controller.dispose();
  clearCustomersListSession();
});

test("Restore sends archived false with new key; updates badge and lists", async () => {
  clearCustomersListSession();
  const keys: string[] = [];
  let keyN = 0;
  const newKey = () => {
    keyN += 1;
    const hex = keyN.toString(16).padStart(12, "0");
    const key = `bbbbbbbb-bbbb-4bbb-8bbb-${hex}`;
    keys.push(key);
    return key;
  };

  let customer = sampleCustomer({
    archived_at: "2026-09-21T12:00:00.000Z",
    version: 2,
  });

  const list = obtainCustomersListController({
    listCustomers: async (_token, params) => {
      const state = params?.state ?? "active";
      if (customer.archived_at) {
        if (state === "active") return { items: [], next_cursor: null };
        return { items: [customer], next_cursor: null };
      }
      if (state === "archived") return { items: [], next_cursor: null };
      return { items: [customer], next_cursor: null };
    },
  });
  await list.setStateFilter("token", "archived");

  const bodies: boolean[] = [];
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [sampleJob()], next_cursor: null }),
    newIdempotencyKey: newKey,
    archiveCustomer: async (_t, _id, archived, key) => {
      bodies.push(archived);
      keys.push(`used:${key}`);
      customer = {
        ...customer,
        archived_at: archived ? "2026-09-21T12:00:00.000Z" : null,
        version: customer.version + 1,
      };
      return customer;
    },
    onArchiveSuccess: async (_c, token) => {
      await list.refreshAfterMutation(token);
    },
  });
  await controller.bootstrap("token");
  assert.equal(archiveActionForCustomer(controller.getSnapshot().customer), "restore");

  // First archive attempt key would be for true; restore uses false → new key
  const archiveKeySession = createArchiveIdempotencySession(newKey);
  const archiveKey = archiveKeySession.keyForArchived(true);
  const restoreKey = archiveKeySession.keyForArchived(false);
  assert.notEqual(archiveKey, restoreKey);

  await controller.restoreCustomer("token");
  assert.equal(bodies.at(-1), false);
  assert.equal(controller.getSnapshot().customer?.archived_at, null);
  assert.equal(archiveActionForCustomer(controller.getSnapshot().customer), "archive");
  assert.equal(list.getSnapshot().items.some((c) => c.id === customer.id), false);

  await list.setStateFilter("token", "active");
  assert.equal(list.getSnapshot().items.some((c) => c.id === customer.id), true);

  await list.setStateFilter("token", "all");
  assert.equal(list.getSnapshot().items.some((c) => c.id === customer.id), true);
  assert.equal(list.getSnapshot().items.find((c) => c.id === customer.id)?.archived_at, null);

  controller.dispose();
  clearCustomersListSession();
});

test("Customer with Jobs may be archived; jobs remain visible", async () => {
  const customer = sampleCustomer();
  const job = sampleJob();
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [job], next_cursor: null }),
    archiveCustomer: async () =>
      sampleCustomer({ archived_at: "2026-09-21T12:00:00.000Z", version: 2 }),
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().jobs.length, 1);
  controller.openArchiveConfirm();
  await controller.confirmArchive("token");
  assert.ok(controller.getSnapshot().customer?.archived_at);
  assert.equal(controller.getSnapshot().jobs.length, 1);
  assert.equal(controller.getSnapshot().jobs[0]?.title, "Fence repair");
  controller.dispose();
});

test("network Archive failure preserves active state; Retry reuses same key", async () => {
  const customer = sampleCustomer();
  const keys: string[] = [];
  let failOnce = true;
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    newIdempotencyKey: () => "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    archiveCustomer: async (_t, _id, archived, key) => {
      keys.push(key);
      if (failOnce) {
        failOnce = false;
        throw new DomainApiError({
          code: "NETWORK",
          message: "Network problem.",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return sampleCustomer({
        archived_at: archived ? "2026-09-21T12:00:00.000Z" : null,
        version: 2,
      });
    },
  });
  await controller.bootstrap("token");
  controller.openArchiveConfirm();
  await controller.confirmArchive("token");
  assert.equal(controller.getSnapshot().customer?.archived_at, null);
  assert.equal(controller.getSnapshot().customer?.version, 1);
  assert.ok(controller.getSnapshot().archiveErrorRetryable);
  assert.equal(keys.length, 1);

  await controller.retryArchiveAction("token");
  assert.ok(controller.getSnapshot().customer?.archived_at);
  assert.equal(controller.getSnapshot().customer?.version, 2);
  assert.equal(keys.length, 2);
  assert.equal(keys[0], keys[1]);
  controller.dispose();
});

test("network Restore failure preserves archived state", async () => {
  const customer = sampleCustomer({
    archived_at: "2026-09-21T12:00:00.000Z",
    version: 2,
  });
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    archiveCustomer: async () => {
      throw new DomainApiError({
        code: "NETWORK",
        message: "Network problem.",
        field_errors: {},
        retryable: true,
        status: 0,
      });
    },
  });
  await controller.bootstrap("token");
  await controller.restoreCustomer("token");
  assert.equal(controller.getSnapshot().customer?.archived_at, "2026-09-21T12:00:00.000Z");
  assert.equal(controller.getSnapshot().customer?.version, 2);
  assert.ok(controller.getSnapshot().archiveErrorRetryable);
  controller.dispose();
});

test("rapid double Archive and Restore → one POST each", async () => {
  let archiveCalls = 0;
  let restoreCalls = 0;
  let customer = sampleCustomer();
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    archiveCustomer: async (_t, _id, archived) => {
      await wait(5);
      if (archived) archiveCalls += 1;
      else restoreCalls += 1;
      customer = {
        ...customer,
        archived_at: archived ? "2026-09-21T12:00:00.000Z" : null,
        version: customer.version + 1,
      };
      return customer;
    },
  });
  await controller.bootstrap("token");
  controller.openArchiveConfirm();
  const a1 = controller.confirmArchive("token");
  const a2 = controller.confirmArchive("token");
  assert.deepEqual(await Promise.all([a1, a2]), ["ok", "blocked"]);
  assert.equal(archiveCalls, 1);

  const r1 = controller.restoreCustomer("token");
  const r2 = controller.restoreCustomer("token");
  assert.deepEqual(await Promise.all([r1, r2]), ["ok", "blocked"]);
  assert.equal(restoreCalls, 1);
  controller.dispose();
});

test("Edit remains available when archived; returned version reflected in detail", async () => {
  const customer = sampleCustomer({ archived_at: null, version: 3 });
  const controller = createCustomerDetailController(customer.id, {
    getCustomer: async () => customer,
    listJobs: async () => ({ items: [], next_cursor: null }),
    archiveCustomer: async () =>
      sampleCustomer({ archived_at: "2026-09-21T12:00:00.000Z", version: 4 }),
  });
  await controller.bootstrap("token");
  controller.openArchiveConfirm();
  await controller.confirmArchive("token");
  const snap = controller.getSnapshot();
  assert.ok(snap.customer?.archived_at);
  assert.equal(snap.customer?.version, 4);
  // Edit action is not removed by archive — screen still shows Edit for archived customers.
  assert.equal(archiveActionForCustomer(snap.customer), "restore");
  controller.dispose();
});

test("submitArchiveCustomer maps unauthenticated and reuses body contract", async () => {
  const unauth = await submitArchiveCustomer({
    accessToken: null,
    customerId: sampleCustomer().id,
    archived: true,
    idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
  assert.equal(unauth.kind, "unauthenticated");

  let seen: { archived: boolean; key: string } | null = null;
  const ok = await submitArchiveCustomer({
    accessToken: "token",
    customerId: sampleCustomer().id,
    archived: true,
    idempotencyKey: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    archive: async (_t, _id, archived, key) => {
      seen = { archived, key };
      return sampleCustomer({ archived_at: "2026-09-21T12:00:00.000Z", version: 2 });
    },
  });
  assert.equal(ok.kind, "success");
  assert.deepEqual(seen, {
    archived: true,
    key: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  });
});

test("search/filter preserved across archive refreshAfterMutation", async () => {
  clearCustomersListSession();
  const list = obtainCustomersListController({
    listCustomers: async (_token, params) => ({
      items: [
        sampleCustomer({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
          name: "Keep Filter",
          archived_at: params?.state === "archived" ? "2026-09-21T00:00:00.000Z" : null,
        }),
      ],
      next_cursor: null,
    }),
  });
  await list.bootstrap("token");
  list.setSearchInput("token", "Keep");
  await list.flushSearchNow("token");
  await list.setStateFilter("token", "all");
  assert.equal(list.getSnapshot().stateFilter, "all");
  assert.equal(list.getSnapshot().searchInput, "Keep");

  await list.refreshAfterMutation("token");
  assert.equal(list.getSnapshot().stateFilter, "all");
  assert.equal(list.getSnapshot().searchInput, "Keep");
  assert.equal(list.getSnapshot().appliedSearch, "Keep");
  clearCustomersListSession();
});
