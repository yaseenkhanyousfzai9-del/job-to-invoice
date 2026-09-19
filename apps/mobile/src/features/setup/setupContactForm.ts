import {
  emptyWorkspaceSetupDraft,
  validateSetupStep2,
  type WorkspaceSetupDraft,
} from "@job-to-invoice/domain";

/** Canonical Step 2 address keys used by both UI and validateSetupStep2. */
export type SetupContactAddressFields = Pick<
  WorkspaceSetupDraft,
  "address_line1" | "address_line2" | "city" | "state" | "zip"
>;

export function normalizeSetupStateInput(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 2);
}

export function normalizeSetupZipInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 9);
  if (digits.length <= 5) {
    return digits;
  }
  return `${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
}

export function clearSetupFieldError(
  errors: Record<string, string>,
  field: string,
): Record<string, string> {
  if (!errors[field]) {
    return errors;
  }
  const next = { ...errors };
  delete next[field];
  return next;
}

export function addressFieldsFromDraft(draft: WorkspaceSetupDraft): SetupContactAddressFields {
  return {
    address_line1: draft.address_line1,
    address_line2: draft.address_line2,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
  };
}

/**
 * Continue must validate the same canonical draft the controlled inputs write.
 */
export function runSetupStep2Continue(draft: WorkspaceSetupDraft): {
  errors: Record<string, string>;
  canAdvance: boolean;
  statePresent: boolean;
  stateLength: number;
  stateNormalizedValid: boolean;
  zipPresent: boolean;
  zipLength: number;
  zipFormatValid: boolean;
} {
  const errors = validateSetupStep2(draft);
  const state = draft.state.trim().toUpperCase();
  const zip = draft.zip.trim();
  return {
    errors,
    canAdvance: Object.keys(errors).length === 0,
    statePresent: state.length > 0,
    stateLength: state.length,
    stateNormalizedValid: !errors["state"],
    zipPresent: zip.length > 0,
    zipLength: zip.length,
    zipFormatValid: !errors["zip"],
  };
}

export function sampleValidStep2Draft(): WorkspaceSetupDraft {
  return {
    ...emptyWorkspaceSetupDraft("America/Chicago"),
    contact_name: "Alex Owner",
    contact_email: "owner@example.com",
    contact_phone: "",
    address_line1: "123 Test Street",
    address_line2: "",
    city: "Austin",
    state: "TX",
    zip: "78701",
  };
}
