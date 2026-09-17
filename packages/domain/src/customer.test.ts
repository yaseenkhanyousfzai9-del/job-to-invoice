import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "./errors.ts";
import {
  CUSTOMER_LIST_DEFAULT_LIMIT,
  duplicateCustomerEmailConflict,
  duplicateEmailWarning,
  isCustomerArchived,
  nextArchivedAt,
  parseCreateCustomerInput,
  parseCustomerArchiveCommand,
  parseCustomerListQuery,
  parseCustomerName,
  parseUpdateCustomerInput,
} from "./customer.ts";
import { normalizeEmail, validateOptionalEmail } from "./email.ts";
import { validateOptionalE164 } from "./phone.ts";

function validAddress() {
  return {
    line1: "100 Main St",
    line2: null,
    city: "Austin",
    state: "TX",
    zip: "78701",
  };
}

test("customer name trims, preserves Unicode, and enforces 1-120", () => {
  assert.equal(parseCustomerName("  Ada  ").value, "Ada");
  assert.equal(parseCustomerName("A").value, "A");
  assert.equal(parseCustomerName("José García").value, "José García");
  assert.equal(parseCustomerName("a".repeat(120)).value.length, 120);
  assert.ok(parseCustomerName("").error);
  assert.ok(parseCustomerName("   ").error);
  assert.ok(parseCustomerName("a".repeat(121)).error);
  assert.ok(parseCustomerName("Ada\u0007").error);
});

test("optional customer email preserves display and does not rewrite plus or dots", () => {
  const parsed = validateOptionalEmail("  A.B+C@Gmail.COM ");
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.display, "A.B+C@Gmail.COM");
  assert.equal(parsed.normalized, "a.b+c@gmail.com");
  assert.equal(normalizeEmail("A.B+C@Gmail.COM"), "a.b+c@gmail.com");
  assert.notEqual(normalizeEmail("ab+c@gmail.com"), normalizeEmail("a.b+c@gmail.com"));
  assert.equal(validateOptionalEmail(null).display, null);
  assert.equal(validateOptionalEmail("").display, null);
  assert.ok(validateOptionalEmail("not-an-email").error);
  assert.ok(validateOptionalEmail(`${"a".repeat(250)}@x.com`).error);
});

test("optional phone accepts E.164 only and does not guess country", () => {
  assert.equal(validateOptionalE164(undefined).value, null);
  assert.equal(validateOptionalE164("+14155552671").value, "+14155552671");
  assert.ok(validateOptionalE164("4155552671").error);
  assert.ok(validateOptionalE164("14155552671").error);
  assert.ok(validateOptionalE164("phone").error);
  assert.ok(validateOptionalE164("+1").error);
});

test("create customer accepts optional contact fields and rejects ownership keys", () => {
  const created = parseCreateCustomerInput({
    name: "  Oak Street  ",
    email: "Owner@example.com",
    phone: "+15551234567",
    billing_address: {
      line1: "100 Main St",
      city: "Austin",
      state: "tx",
      zip: "78701-1234",
    },
  });
  assert.equal(created.name, "Oak Street");
  assert.equal(created.email, "Owner@example.com");
  assert.equal(created.normalized_email, "owner@example.com");
  assert.equal(created.phone, "+15551234567");
  assert.equal(created.billing_address?.state, "TX");
  assert.equal(created.billing_address?.zip, "78701-1234");
  assert.equal(created.billing_address?.line2, null);
  assert.equal(created.confirm_duplicate_email, false);

  const unnamedEmail = parseCreateCustomerInput({ name: "Pat" });
  assert.equal(unnamedEmail.email, null);
  assert.equal(unnamedEmail.normalized_email, null);
  assert.equal(unnamedEmail.phone, null);
  assert.equal(unnamedEmail.billing_address, null);

  assert.throws(
    () => parseCreateCustomerInput({ name: "Pat", workspace_id: "w" }),
    (error: unknown) => error instanceof AppError && error.statusCode === 422 && Boolean(error.fieldErrors["workspace_id"]),
  );
  assert.throws(() => parseCreateCustomerInput({ name: "Pat", id: "c" }));
  assert.throws(() => parseCreateCustomerInput({ name: "Pat", archived_at: null }));
  assert.throws(() => parseCreateCustomerInput({ name: "Pat", version: 1 }));
  assert.throws(() => parseCreateCustomerInput({ name: "Pat", created_at: "x" }));
  assert.throws(() => parseCreateCustomerInput({ name: "Pat", updated_at: "x" }));
  assert.throws(() => parseCreateCustomerInput({ name: "Pat", normalized_email: "x@y.com" }));
});

test("create customer schema allows identical names and does not unique-check email", () => {
  const first = parseCreateCustomerInput({ name: "Jordan Lee", email: "shared@example.com" });
  const second = parseCreateCustomerInput({ name: "Jordan Lee", email: "shared@example.com" });
  assert.equal(first.name, second.name);
  assert.equal(first.normalized_email, second.normalized_email);
  assert.equal(first.confirm_duplicate_email, false);
});

test("billing address optional object still validates VAL02 when present", () => {
  assert.throws(() =>
    parseCreateCustomerInput({
      name: "Pat",
      billing_address: { ...validAddress(), state: "XX" },
    }),
  );
  assert.throws(() =>
    parseCreateCustomerInput({
      name: "Pat",
      billing_address: { ...validAddress(), zip: "12" },
    }),
  );
  assert.throws(() =>
    parseCreateCustomerInput({
      name: "Pat",
      billing_address: { ...validAddress(), line1: "x".repeat(151) },
    }),
  );
  assert.throws(() =>
    parseCreateCustomerInput({
      name: "Pat",
      billing_address: { ...validAddress(), line2: "x".repeat(151) },
    }),
  );
  assert.throws(() =>
    parseCreateCustomerInput({
      name: "Pat",
      billing_address: { ...validAddress(), city: "x".repeat(81) },
    }),
  );
  assert.throws(() =>
    parseCreateCustomerInput({
      name: "Pat",
      billing_address: { city: "Austin", state: "TX", zip: "78701" },
    }),
  );
});

test("update customer permits contact fields and forbids archive/ownership", () => {
  const patched = parseUpdateCustomerInput({ name: "New Name", email: null });
  assert.equal(patched.name, "New Name");
  assert.equal(patched.email, null);
  assert.equal(patched.normalized_email, null);
  assert.equal(patched.phone, undefined);
  assert.throws(() => parseUpdateCustomerInput({}));
  assert.throws(() => parseUpdateCustomerInput({ version: 2 }));
  assert.throws(() => parseUpdateCustomerInput({ archived_at: "2026-01-01T00:00:00.000Z" }));
  assert.throws(() => parseUpdateCustomerInput({ workspace_id: "w", name: "X" }));
  assert.throws(() => parseUpdateCustomerInput({ id: "c", name: "X" }));
  const confirmed = parseUpdateCustomerInput({
    email: "new@example.com",
    confirm_duplicate_email: true,
  });
  assert.equal(confirmed.confirm_duplicate_email, true);
  assert.equal(confirmed.normalized_email, "new@example.com");
});

test("customer list query defaults and rejects invalid limit/state", () => {
  const defaults = parseCustomerListQuery({});
  assert.equal(defaults.limit, CUSTOMER_LIST_DEFAULT_LIMIT);
  assert.equal(defaults.state, "active");
  assert.equal(defaults.search, null);
  const parsed = parseCustomerListQuery({
    search: "  oak  ",
    limit: "10",
    state: "archived",
    cursor: "abc",
  });
  assert.equal(parsed.search, "oak");
  assert.equal(parsed.limit, 10);
  assert.equal(parsed.state, "archived");
  assert.throws(() => parseCustomerListQuery({ limit: 0 }));
  assert.throws(() => parseCustomerListQuery({ limit: -1 }));
  assert.throws(() => parseCustomerListQuery({ limit: 101 }));
  assert.throws(() => parseCustomerListQuery({ state: "deleted" }));
  assert.throws(() => parseCustomerListQuery({ workspace_id: "w" }));
});

test("archive helpers distinguish archive from delete", () => {
  assert.equal(isCustomerArchived(null), false);
  assert.equal(isCustomerArchived("2026-09-18T00:00:00.000Z"), true);
  assert.equal(nextArchivedAt(null, true, "2026-09-18T00:00:00.000Z"), "2026-09-18T00:00:00.000Z");
  assert.equal(nextArchivedAt("2026-01-01T00:00:00.000Z", true, "2026-09-18T00:00:00.000Z"), "2026-01-01T00:00:00.000Z");
  assert.equal(nextArchivedAt("2026-01-01T00:00:00.000Z", false, "2026-09-18T00:00:00.000Z"), null);
  const command = parseCustomerArchiveCommand({ archived: true });
  assert.equal(command.archived, true);
  assert.throws(() => parseCustomerArchiveCommand({ archived: true, id: "x" }));
});

test("duplicate email contract is a confirmation warning, not uniqueness", () => {
  const error = duplicateCustomerEmailConflict();
  assert.equal(error.code, "DUPLICATE_CUSTOMER_EMAIL");
  assert.equal(error.statusCode, 409);
  const warning = duplicateEmailWarning([{ id: "11111111-1111-4111-8111-111111111111", name: "Pat" }]);
  assert.equal(warning.duplicates[0]?.name, "Pat");
  assert.equal(Object.hasOwn(warning.duplicates[0] ?? {}, "email"), false);
});
