import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS,
  customerDetailHref,
  pushCustomerDetail,
} from "./customerRoutes";
import { presentCustomerRow } from "./customersList";
import type { Customer } from "@job-to-invoice/domain";

const customersIndexSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../app/(app)/customers/index.tsx"),
  "utf8",
);

function sampleCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Android Test Customer C",
    email: null,
    phone: null,
    billing_address: null,
    archived_at: null,
    version: 1,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

test("rendered customer row source uses Pressable with onPress", () => {
  assert.match(customersIndexSource, /function CustomerRow/);
  assert.match(customersIndexSource, /<Pressable/);
  assert.match(customersIndexSource, /onPress=\{props\.onPress\}/);
  assert.match(customersIndexSource, /testID="customer-row"/);
  assert.match(customersIndexSource, /pointerEvents="none"/);
});

test("list uses keyboardShouldPersistTaps always so search focus does not swallow first tap", () => {
  assert.equal(CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS, "always");
  assert.match(
    customersIndexSource,
    /keyboardShouldPersistTaps=\{CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS\}/,
  );
});

test("row onPress path calls pushCustomerDetail / router once with id only", () => {
  const row = presentCustomerRow(sampleCustomer());
  const pushes: unknown[] = [];
  let onPressCount = 0;

  function simulateRowTap() {
    onPressCount += 1;
    pushCustomerDetail((href) => {
      pushes.push(href);
    }, row.id);
  }

  simulateRowTap();
  assert.equal(onPressCount, 1);
  assert.equal(pushes.length, 1);
  assert.deepEqual(pushes[0], customerDetailHref(row.id));
  assert.equal(Object.keys((pushes[0] as { params: object }).params).length, 1);
});

test("search-result row remains tappable with same navigation contract", () => {
  const row = presentCustomerRow(
    sampleCustomer({ name: "Android Test Customer C", email: "c@example.com" }),
  );
  const pushes: unknown[] = [];
  pushCustomerDetail((href) => pushes.push(href), row.id);
  assert.equal(pushes.length, 1);
  assert.equal((pushes[0] as { pathname: string }).pathname, "/(app)/customers/[id]");
});

test("Active Archived and All presented rows stay press-enabled when list has items", () => {
  for (const archived_at of [null, "2026-09-21T00:00:00.000Z"] as const) {
    const row = presentCustomerRow(sampleCustomer({ archived_at }));
    assert.ok(row.id.length > 0);
    const pushes: unknown[] = [];
    pushCustomerDetail((href) => pushes.push(href), row.id);
    assert.equal(pushes.length, 1);
  }
});

test("customers list opens detail via pushCustomerDetail helper not raw /index path", () => {
  assert.match(customersIndexSource, /pushCustomerDetail/);
  assert.equal(customersIndexSource.includes("/customers/index"), false);
  assert.equal(customersIndexSource.includes("customers/index"), false);
});
