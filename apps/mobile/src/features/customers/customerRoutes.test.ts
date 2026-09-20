import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CUSTOMERS_LIST_HREF,
  CUSTOMERS_NEW_HREF,
  customersListHrefWithCreatedFlag,
  isInvalidCustomersListHref,
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

test("Add customer targets existing new route", () => {
  assert.equal(CUSTOMERS_NEW_HREF, "/(app)/customers/new");
  assert.equal(existsSync(join(appDir, "(app)", "customers", "new.tsx")), true);
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
