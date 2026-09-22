import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emptyWorkspaceSetupDraft,
  validateSetupStep2,
} from "@job-to-invoice/domain";
import {
  addressFieldsFromDraft,
  clearSetupFieldError,
  normalizeSetupStateInput,
  normalizeSetupZipInput,
  runSetupStep2Continue,
  sampleValidStep2Draft,
} from "./setupContactForm";

test("valid State TX passes", () => {
  const draft = sampleValidStep2Draft();
  assert.equal(validateSetupStep2(draft)["state"], undefined);
  assert.equal(runSetupStep2Continue(draft).stateNormalizedValid, true);
});

test("lowercase tx normalizes and passes", () => {
  assert.equal(normalizeSetupStateInput("tx"), "TX");
  const draft = { ...sampleValidStep2Draft(), state: normalizeSetupStateInput("tx") };
  assert.equal(validateSetupStep2(draft)["state"], undefined);
});

test("invalid single-letter State fails", () => {
  const draft = { ...sampleValidStep2Draft(), state: normalizeSetupStateInput("T") };
  assert.equal(validateSetupStep2(draft)["state"], "Select a two-letter US state.");
});

test("valid ZIP 78701 passes", () => {
  const draft = { ...sampleValidStep2Draft(), zip: "78701" };
  assert.equal(validateSetupStep2(draft)["zip"], undefined);
});

test("valid ZIP+4 passes", () => {
  const draft = {
    ...sampleValidStep2Draft(),
    zip: normalizeSetupZipInput("787012345"),
  };
  assert.equal(draft.zip, "78701-2345");
  assert.equal(validateSetupStep2(draft)["zip"], undefined);
});

test("invalid ZIP fails", () => {
  const draft = { ...sampleValidStep2Draft(), zip: "7870" };
  assert.equal(validateSetupStep2(draft)["zip"], "Enter a 5-digit ZIP or ZIP+4.");
});

test("after invalid State error, changing to TX clears/recomputes error", () => {
  let errors = validateSetupStep2({ ...sampleValidStep2Draft(), state: "" });
  assert.ok(errors["state"]);
  const state = normalizeSetupStateInput("TX");
  errors = clearSetupFieldError(errors, "state");
  const draft = { ...sampleValidStep2Draft(), state };
  const next = validateSetupStep2(draft);
  assert.equal(errors["state"], undefined);
  assert.equal(next["state"], undefined);
});

test("after invalid ZIP error, changing to 78701 clears/recomputes error", () => {
  let errors = validateSetupStep2({ ...sampleValidStep2Draft(), zip: "" });
  assert.ok(errors["zip"]);
  const zip = normalizeSetupZipInput("78701");
  errors = clearSetupFieldError(errors, "zip");
  const next = validateSetupStep2({ ...sampleValidStep2Draft(), zip });
  assert.equal(errors["zip"], undefined);
  assert.equal(next["zip"], undefined);
});

test("visible State value is the same canonical value validation receives", () => {
  const draft = sampleValidStep2Draft();
  const visible = addressFieldsFromDraft(draft).state;
  const result = runSetupStep2Continue(draft);
  assert.equal(visible, "TX");
  assert.equal(result.statePresent, true);
  assert.equal(result.stateLength, 2);
  assert.equal(result.stateNormalizedValid, true);
});

test("visible ZIP value is the same canonical value validation receives", () => {
  const draft = sampleValidStep2Draft();
  const visible = addressFieldsFromDraft(draft).zip;
  const result = runSetupStep2Continue(draft);
  assert.equal(visible, "78701");
  assert.equal(result.zipPresent, true);
  assert.equal(result.zipLength, 5);
  assert.equal(result.zipFormatValid, true);
});

test("valid complete Step 2 form Continue advances", () => {
  const result = runSetupStep2Continue(sampleValidStep2Draft());
  assert.equal(result.canAdvance, true);
  assert.deepEqual(result.errors, {});
});

test("optional Address line 2 blank still passes", () => {
  const draft = { ...sampleValidStep2Draft(), address_line2: "" };
  assert.equal(validateSetupStep2(draft)["address_line2"], undefined);
  assert.equal(runSetupStep2Continue(draft).canAdvance, true);
});

test("Back/forward preserves Step 2 draft fields", () => {
  let draft = emptyWorkspaceSetupDraft("America/Chicago");
  draft = {
    ...draft,
    ...addressFieldsFromDraft(sampleValidStep2Draft()),
    contact_name: "Alex Owner",
    contact_email: "owner@example.com",
  };
  // Simulate leave and return with the same shared draft object reference semantics.
  const restored = { ...draft };
  assert.equal(restored.state, "TX");
  assert.equal(restored.zip, "78701");
  assert.equal(runSetupStep2Continue(restored).canAdvance, true);
});

test("empty draft with TX/78701 placeholders would fail — values must be in draft", () => {
  const empty = emptyWorkspaceSetupDraft("America/Chicago");
  empty.contact_name = "Alex Owner";
  empty.contact_email = "owner@example.com";
  empty.address_line1 = "123 Test Street";
  empty.city = "Austin";
  // Placeholders are not draft values:
  assert.equal(empty.state, "");
  assert.equal(empty.zip, "");
  const errors = validateSetupStep2(empty);
  assert.equal(errors["state"], "Select a two-letter US state.");
  assert.equal(errors["zip"], "Enter a 5-digit ZIP or ZIP+4.");
});
