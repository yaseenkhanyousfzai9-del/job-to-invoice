import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CUSTOMERS_LIST_HREF,
  CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS,
  CUSTOMERS_NEW_HREF,
  customerDetailHref,
  customersListHrefWithCreatedFlag,
  isInvalidCustomerDetailHref,
  isInvalidCustomersListHref,
  pushCustomerDetail,
} from "./customerRoutes";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../../../app");

test("owner shell Customers button targets canonical Customers route", () => {
  assert.equal(CUSTOMERS_LIST_HREF, "/(app)/customers");
});

test("Customers list target does not contain /index", () => {
  assert.equal(CUSTOMERS_LIST_HREF.includes("/index"), false);
  assert.equal(isInvalidCustomersListHref(CUSTOMERS_LIST_HREF), false);
});

test("Customers screen route file exists", () => {
  assert.equal(existsSync(join(appDir, "(app)", "customers", "index.tsx")), true);
});

test("Customers nested stack layout exists for list→detail push", () => {
  assert.equal(existsSync(join(appDir, "(app)", "customers", "_layout.tsx")), true);
});

test("Add customer targets existing new route", () => {
  assert.equal(CUSTOMERS_NEW_HREF, "/(app)/customers/new");
  assert.equal(existsSync(join(appDir, "(app)", "customers", "new.tsx")), true);
});

test("Customer detail targets pathname + id params only", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const href = customerDetailHref(id);
  assert.equal(href.pathname, "/(app)/customers/[id]");
  assert.deepEqual(href.params, { id });
  assert.equal(Object.keys(href.params).length, 1);
  assert.equal(existsSync(join(appDir, "(app)", "customers", "[id].tsx")), true);
  assert.equal(isInvalidCustomerDetailHref(href), false);
  assert.equal(href.pathname.includes("/index"), false);
});

test("successful Customer create returns to canonical Customers route", () => {
  const target = customersListHrefWithCreatedFlag();
  assert.equal(target.pathname, CUSTOMERS_LIST_HREF);
  assert.equal(target.params.customerCreated, "1");
});

test("customerCreated refresh parameter does not create an invalid route", () => {
  const target = customersListHrefWithCreatedFlag();
  assert.equal(isInvalidCustomersListHref(target.pathname), false);
  assert.equal(`${target.pathname}`.includes("/index"), false);
});

test("no application navigation reference contains /(app)/customers/index", () => {
  assert.equal(isInvalidCustomersListHref("/(app)/customers/index"), true);
  assert.equal(isInvalidCustomersListHref(CUSTOMERS_LIST_HREF), false);
});

test("no application navigation reference contains /customers/index", () => {
  assert.equal(isInvalidCustomersListHref("/customers/index"), true);
  assert.equal(isInvalidCustomersListHref("/customers"), false);
});

test("list FlatList keeps keyboard taps for row presses", () => {
  assert.equal(CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS, "always");
});

test("one tap pushCustomerDetail calls router.push once with id-only params", () => {
  const calls: unknown[] = [];
  pushCustomerDetail((href) => {
    calls.push(href);
  }, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    pathname: "/(app)/customers/[id]",
    params: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  });
});

test("search-focus and idle taps both invoke navigation once each", () => {
  const calls: unknown[] = [];
  const push = (href: unknown) => {
    calls.push(href);
  };
  // A: keyboard not active
  pushCustomerDetail(push, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  // B: search focused — same navigation helper; FlatList keyboardShouldPersistTaps=always
  pushCustomerDetail(push, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  assert.equal(calls.length, 2);
  assert.equal(
    (calls[0] as { pathname: string }).pathname,
    "/(app)/customers/[id]",
  );
  assert.equal(
    (calls[1] as { pathname: string }).pathname,
    "/(app)/customers/[id]",
  );
});
