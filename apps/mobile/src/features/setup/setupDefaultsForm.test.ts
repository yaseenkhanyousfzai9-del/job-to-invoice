import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyWorkspaceSetupDraft } from "@job-to-invoice/domain";
import {
  firstSetupStep3Error,
  isSetupStep3CreateEnabled,
  runSetupStep3Create,
} from "./setupDefaultsForm";

function sampleStep3Draft() {
  return {
    ...emptyWorkspaceSetupDraft("Asia/Karachi"),
    business_name: "Test Biz",
    legal_name: "Test Biz LLC",
    trade: "handyman" as const,
    contact_name: "Owner",
    contact_email: "owner@example.com",
    address_line1: "123 Test Street",
    city: "Austin",
    state: "TX",
    zip: "78701",
    timezone_confirmed: false,
    default_tax_bp: "0",
    default_due_days: "14",
    default_terms: "",
  };
}

test("Create stays disabled until timezone is confirmed", () => {
  const draft = sampleStep3Draft();
  assert.equal(isSetupStep3CreateEnabled(draft), false);
  assert.equal(runSetupStep3Create(draft).canSubmit, false);
  assert.equal(runSetupStep3Create(draft).errors["timezone"], "Confirm the business timezone.");
  assert.match(firstSetupStep3Error(runSetupStep3Create(draft).errors) ?? "", /timezone/i);
});

test("confirmed Asia/Karachi with defaults can submit", () => {
  const draft = { ...sampleStep3Draft(), timezone_confirmed: true };
  assert.equal(isSetupStep3CreateEnabled(draft), true);
  const result = runSetupStep3Create(draft);
  assert.equal(result.canSubmit, true);
  assert.equal(result.body?.timezone, "Asia/Karachi");
  assert.equal(result.body?.default_tax_bp, 0);
  assert.equal(result.body?.default_due_days, 14);
  assert.equal(result.body?.default_terms, "");
});

test("editing timezone clears confirmation gate", () => {
  const confirmed = { ...sampleStep3Draft(), timezone_confirmed: true };
  assert.equal(isSetupStep3CreateEnabled(confirmed), true);
  const edited = { ...confirmed, timezone: "America/Chicago", timezone_confirmed: false };
  assert.equal(isSetupStep3CreateEnabled(edited), false);
  assert.equal(runSetupStep3Create(edited).canSubmit, false);
});

test("invalid tax still fails after timezone confirmation", () => {
  const draft = {
    ...sampleStep3Draft(),
    timezone_confirmed: true,
    default_tax_bp: "not-a-number",
  };
  const result = runSetupStep3Create(draft);
  assert.equal(result.canSubmit, false);
  assert.ok(result.errors["default_tax_bp"]);
});
