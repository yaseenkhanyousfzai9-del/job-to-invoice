import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { layout } from "../../theme/tokens";
import { DELETE_ACTION_LABEL } from "./customerDelete";
import { presentCustomerRow } from "./customersList";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

test("Customer list archived state is text-labelled, not color-only", () => {
  const row = presentCustomerRow({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Archived Pat",
    email: null,
    phone: null,
    billing_address: null,
    archived_at: "2026-09-21T00:00:00.000Z",
    version: 1,
    created_at: "2026-09-21T00:00:00.000Z",
    updated_at: "2026-09-21T00:00:00.000Z",
  });
  assert.equal(row.archivedLabel, "Archived");
  assert.match(row.accessibilityLabel, /Archived/);
});

test("Customer screens keep minimum touch targets in tokens", () => {
  assert.ok(layout.minTouchTarget >= 44);
  assert.ok(layout.buttonMinHeight >= 44);
});

test("Customer Detail Delete uses DestructiveButton (semantic separation)", () => {
  const detail = readFileSync(
    join(root, "app/(app)/customers/[id]/index.tsx"),
    "utf8",
  );
  assert.match(detail, /DestructiveButton/);
  assert.match(detail, /DELETE_ACTION_LABEL/);
  assert.match(detail, /accessibilityHint/);
  assert.match(detail, /colors\.danger/);
  assert.equal(DELETE_ACTION_LABEL, "Delete customer");
});

test("Customer forms use KeyboardAvoidingView", () => {
  const create = readFileSync(join(root, "app/(app)/customers/new.tsx"), "utf8");
  const edit = readFileSync(join(root, "app/(app)/customers/[id]/edit.tsx"), "utf8");
  assert.match(create, /KeyboardAvoidingView/);
  assert.match(edit, /KeyboardAvoidingView/);
});

test("Customer list filter chips declare accessibility roles", () => {
  const list = readFileSync(join(root, "app/(app)/customers/index.tsx"), "utf8");
  assert.match(list, /accessibilityRole="tablist"/);
  assert.match(list, /accessibilityRole="tab"/);
  assert.match(list, /minTouchTarget/);
});
