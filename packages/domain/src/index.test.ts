import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AppError,
  createRequestId,
  maskEmail,
  normalizeEmail,
  parseWorkspaceCreateBody,
  resolveOwnerNavigation,
  validateEmail,
  validateOptionalE164,
  validateSetupStep1,
  validateSetupStep3,
  emptyWorkspaceSetupDraft,
} from "./index.ts";

test("AppError preserves code and retryable flag", () => {
  const error = new AppError("VALIDATION_FAILED", "Invalid field", false, 422);
  assert.equal(error.name, "AppError");
  assert.equal(error.code, "VALIDATION_FAILED");
  assert.equal(error.message, "Invalid field");
  assert.equal(error.retryable, false);
  assert.equal(error.statusCode, 422);
});

test("createRequestId returns a UUID string", () => {
  const id = createRequestId();
  assert.match(
    id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("email normalization lowercases without rewriting plus or dots", () => {
  assert.equal(normalizeEmail("  A.B+C@Gmail.COM "), "a.b+c@gmail.com");
  const parsed = validateEmail("a.b+c@gmail.com");
  assert.equal(parsed.error, undefined);
  assert.equal(parsed.normalized, "a.b+c@gmail.com");
});

test("email validation rejects missing and overlong values", () => {
  assert.ok(validateEmail("").error);
  assert.ok(validateEmail("not-an-email").error);
  assert.ok(validateEmail(`${"a".repeat(250)}@x.com`).error);
});

test("maskEmail hides the local part", () => {
  assert.equal(maskEmail("owner@example.com"), "o•••@example.com");
});

test("optional phone requires E.164 and does not guess +1", () => {
  assert.equal(validateOptionalE164(null).value, null);
  assert.equal(validateOptionalE164("").value, null);
  assert.equal(validateOptionalE164("+15551234567").value, "+15551234567");
  assert.ok(validateOptionalE164("5551234567").error);
  assert.ok(validateOptionalE164("15551234567").error);
});

function validWorkspaceBody() {
  return {
    business_name: "Oak & Pine Handyman",
    legal_name: "Oak and Pine LLC",
    contact_name: "Alex Rivera",
    contact_email: "Alex.Rivera+ops@example.com",
    contact_phone: null,
    address: {
      line1: "100 Main St",
      line2: null,
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    timezone: "America/Chicago",
    trade: "handyman",
    default_tax_bp: 0,
    default_due_days: 14,
    default_terms: "",
  };
}

test("workspace create accepts Unicode names and ZIP+4", () => {
  const parsed = parseWorkspaceCreateBody({
    ...validWorkspaceBody(),
    business_name: "José’s Repair",
    address: {
      line1: "100 Main St",
      line2: "Suite 2",
      city: "Austin",
      state: "tx",
      zip: "78701-1234",
    },
  });
  assert.equal(parsed.business_name, "José’s Repair");
  assert.equal(parsed.address.state, "TX");
  assert.equal(parsed.address.zip, "78701-1234");
  assert.equal(parsed.contact_email_normalized, "alex.rivera+ops@example.com");
});

test("workspace create rejects unknown fields and client ownership ids", () => {
  assert.throws(
    () => parseWorkspaceCreateBody({ ...validWorkspaceBody(), owner_user_id: "x" }),
    (error: unknown) => error instanceof AppError && error.code === "VALIDATION_FAILED" && error.statusCode === 422,
  );
  assert.throws(
    () => parseWorkspaceCreateBody({ ...validWorkspaceBody(), workspace_id: "x" }),
    (error: unknown) => error instanceof AppError && error.fieldErrors["workspace_id"] !== undefined,
  );
});

test("workspace create rejects invalid address and tax", () => {
  assert.throws(() =>
    parseWorkspaceCreateBody({
      ...validWorkspaceBody(),
      address: { ...validWorkspaceBody().address, zip: "12" },
    }),
  );
  assert.throws(() =>
    parseWorkspaceCreateBody({
      ...validWorkspaceBody(),
      default_tax_bp: 0.5,
    }),
  );
});

test("setup step 1 validation uses VAL01 bounds", () => {
  const draft = emptyWorkspaceSetupDraft("America/Chicago");
  const errors = validateSetupStep1(draft);
  assert.ok(errors["business_name"]);
  assert.ok(errors["trade"]);
});

test("setup step 3 requires timezone confirmation before submit", () => {
  const unconfirmed = {
    ...emptyWorkspaceSetupDraft("Asia/Karachi"),
    timezone_confirmed: false,
    default_tax_bp: "0",
    default_due_days: "14",
  };
  assert.equal(validateSetupStep3(unconfirmed)["timezone"], "Confirm the business timezone.");
  const confirmed = { ...unconfirmed, timezone_confirmed: true };
  assert.equal(validateSetupStep3(confirmed)["timezone"], undefined);
});

test("resolveOwnerNavigation maps session and bootstrap state", () => {
  assert.equal(resolveOwnerNavigation({ hasSession: false, me: null }), "welcome");
  assert.equal(resolveOwnerNavigation({ hasSession: true, me: null }), "sign_in");
  assert.equal(
    resolveOwnerNavigation({
      hasSession: true,
      me: {
        user: { id: "u", display_email: "a@b.com", status: "active" },
        bootstrap_state: "needs_workspace",
        workspace: null,
        membership: null,
        allowances: null,
        entitlement: { status: "none", product_id: null, expires_at: null },
      },
    }),
    "setup",
  );
  assert.equal(
    resolveOwnerNavigation({
      hasSession: true,
      me: {
        user: { id: "u", display_email: "a@b.com", status: "active" },
        bootstrap_state: "ready",
        workspace: {
          id: "w",
          business_name: "Biz",
          trade: "handyman",
          timezone: "America/Chicago",
          currency: "USD",
          version: 1,
        },
        membership: { role: "owner", status: "active" },
        allowances: {
          free_jobs_consumed: 0,
          trial_started_at: null,
          trial_ends_at: null,
          trial_jobs_consumed: 0,
          retained_bytes: 0,
          version: 1,
        },
        entitlement: { status: "none", product_id: null, expires_at: null },
      },
    }),
    "app",
  );
  assert.equal(
    resolveOwnerNavigation({
      hasSession: true,
      me: {
        user: { id: "u", display_email: "a@b.com", status: "suspended" },
        bootstrap_state: "ready",
        workspace: null,
        membership: null,
        allowances: null,
        entitlement: { status: "none", product_id: null, expires_at: null },
      },
    }),
    "suspended",
  );
});
