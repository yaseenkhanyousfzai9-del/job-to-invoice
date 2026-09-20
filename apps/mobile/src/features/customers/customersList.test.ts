import assert from "node:assert/strict";
import { test } from "node:test";
import type { Customer } from "@job-to-invoice/domain";
import { DomainApiError, buildListCustomersPath, type CustomerListPage } from "../../lib/api";
import {
  CUSTOMERS_LIST_DEFAULT_LIMIT,
  appendCustomerPage,
  buildInitialListParams,
  createCustomersListController,
  emptyCustomersCopy,
  initialCustomersListSnapshot,
  listErrorRequiresSignOut,
  normalizeListSearch,
  presentCustomerRow,
  showCustomersEmptyState,
  showCustomersInitialLoading,
} from "./customersList";

function customer(overrides: Partial<Customer> & Pick<Customer, "id" | "name">): Customer {
  return {
    email: null,
    phone: null,
    billing_address: null,
    archived_at: null,
    version: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("initial request uses state=active and limit=25", async () => {
  const calls: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  assert.deepEqual(calls, [`/v1/customers?state=active&limit=${CUSTOMERS_LIST_DEFAULT_LIMIT}`]);
  assert.deepEqual(buildInitialListParams(initialCustomersListSnapshot()), {
    state: "active",
    search: null,
    limit: 25,
    cursor: null,
  });
});

test("loading state hides empty copy until ready", async () => {
  const gate = deferred<CustomerListPage>();
  const controller = createCustomersListController({
    listCustomers: async () => gate.promise,
  });
  const pending = controller.bootstrap("token");
  const loading = controller.getSnapshot();
  assert.equal(loading.phase, "loading");
  assert.equal(showCustomersInitialLoading(loading), true);
  assert.equal(showCustomersEmptyState(loading), false);
  gate.resolve({ items: [], next_cursor: null });
  await pending;
  assert.equal(showCustomersEmptyState(controller.getSnapshot()), true);
});

test("active customer rendering includes optional email and phone when present", async () => {
  const controller = createCustomersListController({
    listCustomers: async () => ({
      items: [
        customer({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Jordan Lee",
          email: "jordan@example.com",
          phone: "+14155552671",
        }),
      ],
      next_cursor: null,
    }),
  });
  await controller.bootstrap("token");
  const row = presentCustomerRow(controller.getSnapshot().items[0]!);
  assert.equal(row.name, "Jordan Lee");
  assert.equal(row.email, "jordan@example.com");
  assert.equal(row.phone, "+14155552671");
  assert.equal(row.archivedLabel, null);
});

test("optional email and phone absent stay null without placeholders", () => {
  const row = presentCustomerRow(
    customer({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Pat" }),
  );
  assert.equal(row.email, null);
  assert.equal(row.phone, null);
  assert.equal(row.accessibilityLabel, "Pat");
});

test("archived label rendering is text not color-only", () => {
  const row = presentCustomerRow(
    customer({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "Archived Pat",
      archived_at: "2026-02-01T00:00:00.000Z",
    }),
  );
  assert.equal(row.archivedLabel, "Archived");
  assert.match(row.accessibilityLabel, /Archived/);
});

test("empty active state copy", () => {
  assert.equal(emptyCustomersCopy({ stateFilter: "active", appliedSearch: null }), "No customers yet.");
});

test("empty archived state copy", () => {
  assert.equal(
    emptyCustomersCopy({ stateFilter: "archived", appliedSearch: null }),
    "No archived customers.",
  );
});

test("empty search state copy", () => {
  assert.equal(
    emptyCustomersCopy({ stateFilter: "active", appliedSearch: "zzz" }),
    "No customers found.",
  );
});

test("search sends correct query after trim", async () => {
  const calls: string[] = [];
  const pendingFns: Array<() => void> = [];
  const controller = createCustomersListController({
    debounceMs: 10,
    schedule: (fn) => {
      pendingFns.push(fn);
      return { cancel: () => undefined };
    },
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  controller.setSearchInput("token", "  Jordan  ");
  assert.equal(pendingFns.length, 1);
  pendingFns[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(calls.some((path) => path.includes("search=Jordan") && path.includes("state=active")));
  assert.equal(normalizeListSearch("  "), null);
});

test("rapid search cannot allow stale response to replace latest results", async () => {
  const slow = deferred<CustomerListPage>();
  const fast = deferred<CustomerListPage>();
  const controller = createCustomersListController({
    listCustomers: async (_token, params = {}) => {
      if (params.search === "alpha") return slow.promise;
      if (params.search === "beta") return fast.promise;
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");

  controller.setSearchInput("token", "alpha");
  const pendingAlpha = controller.flushSearchNow("token");
  controller.setSearchInput("token", "beta");
  const pendingBeta = controller.flushSearchNow("token");

  fast.resolve({
    items: [customer({ id: "11111111-1111-4111-8111-111111111111", name: "Beta" })],
    next_cursor: null,
  });
  await pendingBeta;

  slow.resolve({
    items: [customer({ id: "22222222-2222-4222-8222-222222222222", name: "Alpha" })],
    next_cursor: null,
  });
  await pendingAlpha;

  assert.equal(controller.getSnapshot().items[0]?.name, "Beta");
  assert.equal(controller.getSnapshot().appliedSearch, "beta");
});

test("Active filter request", async () => {
  const calls: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  await controller.setStateFilter("token", "archived");
  await controller.setStateFilter("token", "active");
  assert.ok(calls.at(-1)?.includes("state=active"));
});

test("Archived filter request", async () => {
  const calls: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  await controller.setStateFilter("token", "archived");
  assert.ok(calls.at(-1)?.includes("state=archived"));
});

test("All filter request", async () => {
  const calls: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  await controller.setStateFilter("token", "all");
  assert.ok(calls.at(-1)?.includes("state=all"));
});

test("changing filter resets pagination", async () => {
  const calls: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return {
        items: [customer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "One" })],
        next_cursor: "cursor-keep",
      };
    },
  });
  await controller.bootstrap("token");
  await controller.loadMore("token").catch(() => undefined);
  // First page had cursor; filter change must request without cursor.
  await controller.setStateFilter("token", "archived");
  assert.equal(calls.at(-1)?.includes("cursor="), false);
  assert.equal(controller.getSnapshot().items.length, 1);
});

test("next_cursor enables Load more and appends rows; duplicate Load more blocked", async () => {
  const slow = deferred<CustomerListPage>();
  let moreCalls = 0;
  const controller = createCustomersListController({
    listCustomers: async (_token, params = {}) => {
      if (params.cursor) {
        moreCalls += 1;
        return slow.promise;
      }
      return {
        items: [customer({ id: "11111111-1111-4111-8111-111111111111", name: "First" })],
        next_cursor: "cursor-a",
      };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().nextCursor, "cursor-a");

  const firstMore = controller.loadMore("token");
  const blocked = await controller.loadMore("token");
  assert.equal(blocked, "blocked");
  assert.equal(moreCalls, 1);

  slow.resolve({
    items: [
      customer({ id: "11111111-1111-4111-8111-111111111111", name: "First" }),
      customer({ id: "22222222-2222-4222-8222-222222222222", name: "Second" }),
    ],
    next_cursor: null,
  });
  await firstMore;
  assert.deepEqual(
    controller.getSnapshot().items.map((item) => item.name),
    ["First", "Second"],
  );
  assert.equal(controller.getSnapshot().nextCursor, null);
});

test("network error state and Retry re-fetches list", async () => {
  let fail = true;
  let calls = 0;
  const controller = createCustomersListController({
    listCustomers: async () => {
      calls += 1;
      if (fail) {
        throw new DomainApiError({
          code: "NETWORK",
          message: "Network problem",
          field_errors: {},
          retryable: true,
          status: 0,
        });
      }
      return {
        items: [customer({ id: "33333333-3333-4333-8333-333333333333", name: "Recovered" })],
        next_cursor: null,
      };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().phase, "error");
  assert.equal(controller.getSnapshot().errorRetryable, true);
  fail = false;
  await controller.retry("token");
  assert.equal(controller.getSnapshot().phase, "ready");
  assert.equal(controller.getSnapshot().items[0]?.name, "Recovered");
  assert.ok(calls >= 2);
});

test("transient error does not require sign-out", () => {
  assert.equal(
    listErrorRequiresSignOut(
      new DomainApiError({
        code: "NETWORK",
        message: "Network problem",
        field_errors: {},
        retryable: true,
        status: 0,
      }),
    ),
    false,
  );
  assert.equal(
    listErrorRequiresSignOut(
      new DomainApiError({
        code: "INTERNAL_ERROR",
        message: "Server error",
        field_errors: {},
        retryable: true,
        status: 503,
      }),
    ),
    false,
  );
  assert.equal(
    listErrorRequiresSignOut(
      new DomainApiError({
        code: "UNAUTHENTICATED",
        message: "Sign in",
        field_errors: {},
        retryable: false,
        status: 401,
      }),
    ),
    true,
  );
});

test("search still debounces around the intended delay", async () => {
  const calls: string[] = [];
  const pending: Array<() => void> = [];
  const controller = createCustomersListController({
    debounceMs: 400,
    schedule: (fn, ms) => {
      assert.equal(ms, 400);
      pending.push(fn);
      return { cancel: () => undefined };
    },
    listCustomers: async (_token, params) => {
      calls.push(buildListCustomersPath(params));
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  const before = calls.length;
  controller.setSearchInput("token", "Jo");
  assert.equal(calls.length, before);
  assert.equal(pending.length, 1);
  pending[0]!();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(calls.at(-1)?.includes("search=Jo"));
});

test("filter change does NOT wait for search debounce and starts immediately", async () => {
  const callStates: string[] = [];
  let pendingSearch: (() => void) | null = null;
  const controller = createCustomersListController({
    debounceMs: 400,
    schedule: (fn) => {
      pendingSearch = fn;
      return { cancel: () => undefined };
    },
    listCustomers: async (_token, params) => {
      callStates.push(params?.state ?? "active");
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  controller.setSearchInput("token", "pending");
  assert.ok(pendingSearch);
  // Filter must fire before the debounced search runs.
  await controller.setStateFilter("token", "archived");
  assert.ok(callStates.includes("archived"));
  assert.equal(controller.getSnapshot().stateFilter, "archived");
});

test("Active → Archived and Archived → All start request without debounce wait", async () => {
  const order: string[] = [];
  const controller = createCustomersListController({
    debounceMs: 10_000,
    schedule: () => ({ cancel: () => undefined }),
    listCustomers: async (_token, params) => {
      order.push(params?.state ?? "active");
      return {
        items: [],
        next_cursor: "cursor-x",
      };
    },
  });
  await controller.bootstrap("token");
  await controller.setStateFilter("token", "archived");
  await controller.setStateFilter("token", "all");
  assert.deepEqual(order, ["active", "archived", "all"]);
  assert.equal(controller.getSnapshot().nextCursor, "cursor-x");
});

test("changing filter still resets pagination cursor on next request", async () => {
  const paths: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      paths.push(buildListCustomersPath(params));
      return {
        items: [customer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "One" })],
        next_cursor: "keep-me",
      };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().nextCursor, "keep-me");
  await controller.setStateFilter("token", "archived");
  assert.equal(paths.at(-1)?.includes("cursor="), false);
});

test("stale older filter response cannot overwrite latest filter result", async () => {
  const slow = deferred<CustomerListPage>();
  const fast = deferred<CustomerListPage>();
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      if (params?.state === "archived") return slow.promise;
      if (params?.state === "all") return fast.promise;
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  const pendingArchived = controller.setStateFilter("token", "archived");
  const pendingAll = controller.setStateFilter("token", "all");
  fast.resolve({
    items: [customer({ id: "11111111-1111-4111-8111-111111111111", name: "All" })],
    next_cursor: null,
  });
  await pendingAll;
  slow.resolve({
    items: [customer({ id: "22222222-2222-4222-8222-222222222222", name: "Archived" })],
    next_cursor: null,
  });
  await pendingArchived;
  assert.equal(controller.getSnapshot().stateFilter, "all");
  assert.equal(controller.getSnapshot().items[0]?.name, "All");
});

test("duplicate filter tap for same state does not issue another request", async () => {
  let calls = 0;
  const controller = createCustomersListController({
    listCustomers: async () => {
      calls += 1;
      return { items: [], next_cursor: null };
    },
  });
  await controller.bootstrap("token");
  const afterBoot = calls;
  await controller.setStateFilter("token", "active");
  assert.equal(calls, afterBoot);
});

test("repeat filter switch uses cached page immediately while refresh runs", async () => {
  const slow = deferred<CustomerListPage>();
  let archivedCalls = 0;
  const controller = createCustomersListController({
    listCustomers: async (_token, params) => {
      if (params?.state === "archived") {
        archivedCalls += 1;
        if (archivedCalls === 1) {
          return {
            items: [customer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Archived One" })],
            next_cursor: null,
          };
        }
        return slow.promise;
      }
      return {
        items: [customer({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Active One" })],
        next_cursor: null,
      };
    },
  });
  await controller.bootstrap("token");
  await controller.setStateFilter("token", "archived");
  await controller.setStateFilter("token", "active");
  const second = controller.setStateFilter("token", "archived");
  assert.equal(controller.getSnapshot().items[0]?.name, "Archived One");
  assert.equal(controller.getSnapshot().phase, "loading");
  slow.resolve({
    items: [customer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Archived One" })],
    next_cursor: null,
  });
  await second;
});

test("authenticated list request uses provided access token only (no bootstrap/login)", async () => {
  const tokens: string[] = [];
  const controller = createCustomersListController({
    listCustomers: async (accessToken) => {
      tokens.push(accessToken);
      return { items: [], next_cursor: null };
    },
  });
  await controller.setStateFilter("access-token-xyz", "archived");
  assert.deepEqual(tokens, ["access-token-xyz"]);
});

test("return after create refreshes list", async () => {
  let calls = 0;
  const controller = createCustomersListController({
    listCustomers: async () => {
      calls += 1;
      return {
        items: [
          customer({
            id: "44444444-4444-4444-8444-444444444444",
            name: calls === 1 ? "Before" : "After Create",
          }),
        ],
        next_cursor: null,
      };
    },
  });
  await controller.bootstrap("token");
  assert.equal(controller.getSnapshot().items[0]?.name, "Before");
  await controller.refreshPreservingFilters("token");
  assert.equal(controller.getSnapshot().items[0]?.name, "After Create");
  assert.equal(calls, 2);
});

test("appendCustomerPage skips duplicate ids", () => {
  const first = customer({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "A" });
  const second = customer({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "B" });
  const merged = appendCustomerPage([first], {
    items: [first, second],
    next_cursor: null,
  });
  assert.equal(merged.items.length, 2);
});
