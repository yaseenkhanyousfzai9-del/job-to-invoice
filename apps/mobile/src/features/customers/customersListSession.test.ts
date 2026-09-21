import assert from "node:assert/strict";
import { test } from "node:test";
import type { Customer } from "@job-to-invoice/domain";
import { buildListCustomersPath } from "./customersList";
import {
  clearCustomersListSession,
  customersListHasBootstrapped,
  dropCustomersListControllerForTest,
  getCustomersListUiState,
  markCustomersListBootstrapped,
  nextCustomersListFocusAction,
  obtainCustomersListController,
  syncCustomersListUiFromSnapshot,
} from "./customersListSession";

function sampleCustomer(name: string): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name,
    email: null,
    phone: null,
    billing_address: null,
    archived_at: null,
    version: 1,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
  };
}

test("focus action is bootstrap first, then refresh after bootstrap", () => {
  clearCustomersListSession();
  assert.equal(nextCustomersListFocusAction(false), "bootstrap");
  assert.equal(nextCustomersListFocusAction(true), "refresh");
});

test("search text and filter survive remount; focus refresh keeps query", async () => {
  clearCustomersListSession();
  const calls: string[] = [];
  const controller = obtainCustomersListController({
    debounceMs: 0,
    listCustomers: async (_token, params = {}) => {
      calls.push(buildListCustomersPath(params));
      return {
        items: [sampleCustomer("Android Test Customer C")],
        next_cursor: null,
      };
    },
  });

  await controller.bootstrap("token");
  markCustomersListBootstrapped();
  controller.setSearchInput("token", "Android Test Customer C");
  await controller.flushSearchNow("token");
  await controller.setStateFilter("token", "active");
  syncCustomersListUiFromSnapshot(controller.getSnapshot());

  assert.equal(controller.getSnapshot().searchInput, "Android Test Customer C");
  assert.equal(controller.getSnapshot().appliedSearch, "Android Test Customer C");
  assert.equal(customersListHasBootstrapped(), true);

  // Simulate list screen remount (Detail push can remount index).
  dropCustomersListControllerForTest();
  const remounted = obtainCustomersListController({
    debounceMs: 0,
    listCustomers: async (_token, params = {}) => {
      calls.push(buildListCustomersPath(params));
      return {
        items: [sampleCustomer("Android Test Customer C")],
        next_cursor: null,
      };
    },
  });

  assert.equal(remounted.getSnapshot().searchInput, "Android Test Customer C");
  assert.equal(remounted.getSnapshot().appliedSearch, "Android Test Customer C");
  assert.equal(remounted.getSnapshot().stateFilter, "active");
  assert.equal(getCustomersListUiState().searchInput, "Android Test Customer C");

  assert.equal(nextCustomersListFocusAction(), "refresh");
  const before = calls.length;
  await remounted.refreshPreservingFilters("token");
  assert.equal(calls.length, before + 1);
  assert.match(calls[calls.length - 1] ?? "", /search=Android\+Test\+Customer\+C/);
  assert.match(calls[calls.length - 1] ?? "", /state=active/);
  assert.equal(remounted.getSnapshot().searchInput, "Android Test Customer C");

  clearCustomersListSession();
});

test("Archived and All filters survive remount", async () => {
  for (const stateFilter of ["archived", "all"] as const) {
    clearCustomersListSession();
    const controller = obtainCustomersListController({
      listCustomers: async () => ({ items: [], next_cursor: null }),
    });
    await controller.bootstrap("token");
    markCustomersListBootstrapped();
    await controller.setStateFilter("token", stateFilter);
    syncCustomersListUiFromSnapshot(controller.getSnapshot());

    dropCustomersListControllerForTest();
    const remounted = obtainCustomersListController({
      listCustomers: async () => ({ items: [], next_cursor: null }),
    });
    assert.equal(remounted.getSnapshot().stateFilter, stateFilter);
    assert.equal(nextCustomersListFocusAction(), "refresh");
  }
  clearCustomersListSession();
});

test("Active filter survives remount", async () => {
  clearCustomersListSession();
  const controller = obtainCustomersListController({
    listCustomers: async () => ({ items: [], next_cursor: null }),
  });
  await controller.bootstrap("token");
  markCustomersListBootstrapped();
  await controller.setStateFilter("token", "archived");
  await controller.setStateFilter("token", "active");
  syncCustomersListUiFromSnapshot(controller.getSnapshot());
  dropCustomersListControllerForTest();
  const remounted = obtainCustomersListController({
    listCustomers: async () => ({ items: [], next_cursor: null }),
  });
  assert.equal(remounted.getSnapshot().stateFilter, "active");
  clearCustomersListSession();
});

test("sign-out clear resets search/filter session", async () => {
  clearCustomersListSession();
  const controller = obtainCustomersListController({
    listCustomers: async () => ({ items: [], next_cursor: null }),
  });
  await controller.bootstrap("token");
  markCustomersListBootstrapped();
  controller.setSearchInput("token", "keep me");
  await controller.flushSearchNow("token");
  syncCustomersListUiFromSnapshot(controller.getSnapshot());

  clearCustomersListSession();
  assert.equal(customersListHasBootstrapped(), false);
  assert.deepEqual(getCustomersListUiState(), {
    searchInput: "",
    appliedSearch: null,
    stateFilter: "active",
  });
  assert.equal(nextCustomersListFocusAction(), "bootstrap");
});
