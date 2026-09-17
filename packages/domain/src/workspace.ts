import { parseUsAddress, type UsAddress } from "./address.ts";
import { validateEmail } from "./email.ts";
import { validationFailed } from "./errors.ts";
import { validateOptionalE164 } from "./phone.ts";
import { requireBoundedName, requireOptionalMultiline } from "./text.ts";

export const CURRENT_TERMS_VERSION = "2026-09-01";
export const CURRENT_PRIVACY_VERSION = "2026-09-01";

export const WORKSPACE_TRADES = ["handyman", "other"] as const;
export type WorkspaceTrade = (typeof WORKSPACE_TRADES)[number];

export type WorkspaceCreateInput = {
  business_name: string;
  legal_name: string;
  contact_name: string;
  contact_email: string;
  contact_email_normalized: string;
  contact_phone: string | null;
  address: UsAddress;
  timezone: string;
  trade: WorkspaceTrade;
  default_tax_bp: number;
  default_due_days: number;
  default_terms: string;
};

const ALLOWED_WORKSPACE_KEYS = new Set([
  "business_name",
  "legal_name",
  "contact_name",
  "contact_email",
  "contact_phone",
  "address",
  "timezone",
  "trade",
  "default_tax_bp",
  "default_due_days",
  "default_terms",
]);

function isIanaTimeZone(value: string): boolean {
  try {
    const supported = Intl.supportedValuesOf("timeZone");
    return supported.includes(value);
  } catch {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
      return value.length > 0 && !value.includes(" ");
    } catch {
      return false;
    }
  }
}

export function parseWorkspaceCreateBody(raw: unknown): WorkspaceCreateInput {
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw validationFailed({ body: ["Request body must be a JSON object."] });
  }

  const body = raw as Record<string, unknown>;
  const fieldErrors: Record<string, string[]> = {};

  for (const key of Object.keys(body)) {
    if (!ALLOWED_WORKSPACE_KEYS.has(key)) {
      fieldErrors[key] = ["Unknown field."];
    }
  }

  const businessName = requireBoundedName(body["business_name"], 2, 100);
  const legalName = requireBoundedName(body["legal_name"], 2, 150);
  const contactName = requireBoundedName(body["contact_name"], 2, 100);
  const email = validateEmail(body["contact_email"]);
  const phone = validateOptionalE164(body["contact_phone"]);
  const address = parseUsAddress(body["address"]);
  const terms = requireOptionalMultiline(body["default_terms"], 4000);

  if (businessName.error) fieldErrors["business_name"] = [businessName.error];
  if (legalName.error) fieldErrors["legal_name"] = [legalName.error];
  if (contactName.error) fieldErrors["contact_name"] = [contactName.error];
  if (email.error) fieldErrors["contact_email"] = [email.error];
  if (phone.error) fieldErrors["contact_phone"] = [phone.error];
  if (terms.error) fieldErrors["default_terms"] = [terms.error];
  Object.assign(fieldErrors, address.fieldErrors);

  const timezone = typeof body["timezone"] === "string" ? body["timezone"].trim() : "";
  if (!timezone || !isIanaTimeZone(timezone)) {
    fieldErrors["timezone"] = ["Confirm a valid IANA timezone."];
  }

  const trade = body["trade"];
  if (trade !== "handyman" && trade !== "other") {
    fieldErrors["trade"] = ["Select handyman or other."];
  }

  const taxRaw = body["default_tax_bp"];
  if (
    typeof taxRaw !== "number" ||
    !Number.isInteger(taxRaw) ||
    taxRaw < 0 ||
    taxRaw > 10000
  ) {
    fieldErrors["default_tax_bp"] = ["Enter tax in basis points from 0 to 10000. This is not tax advice."];
  }

  const dueRaw = body["default_due_days"];
  if (
    typeof dueRaw !== "number" ||
    !Number.isInteger(dueRaw) ||
    dueRaw < 0 ||
    dueRaw > 365
  ) {
    fieldErrors["default_due_days"] = ["Enter due days from 0 to 365."];
  }

  if (Object.keys(fieldErrors).length > 0 || address.value === undefined) {
    throw validationFailed(fieldErrors);
  }

  const resolvedTrade: WorkspaceTrade = trade === "other" ? "other" : "handyman";
  const taxBp = taxRaw as number;
  const dueDays = dueRaw as number;

  return {
    business_name: businessName.value,
    legal_name: legalName.value,
    contact_name: contactName.value,
    contact_email: email.display,
    contact_email_normalized: email.normalized,
    contact_phone: phone.value,
    address: address.value,
    timezone,
    trade: resolvedTrade,
    default_tax_bp: taxBp,
    default_due_days: dueDays,
    default_terms: terms.value,
  };
}

export type WorkspaceSetupDraft = {
  business_name: string;
  trade: WorkspaceTrade | "";
  legal_name: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  timezone: string;
  timezone_confirmed: boolean;
  default_tax_bp: string;
  default_due_days: string;
  default_terms: string;
};

export function emptyWorkspaceSetupDraft(timezone: string): WorkspaceSetupDraft {
  return {
    business_name: "",
    trade: "",
    legal_name: "",
    contact_name: "",
    contact_email: "",
    contact_phone: "",
    address_line1: "",
    address_line2: "",
    city: "",
    state: "",
    zip: "",
    timezone,
    timezone_confirmed: false,
    default_tax_bp: "0",
    default_due_days: "14",
    default_terms: "",
  };
}

export function validateSetupStep1(draft: WorkspaceSetupDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const businessName = requireBoundedName(draft.business_name, 2, 100);
  const legalName = requireBoundedName(draft.legal_name, 2, 150);
  if (businessName.error) errors["business_name"] = businessName.error;
  if (legalName.error) errors["legal_name"] = legalName.error;
  if (draft.trade !== "handyman" && draft.trade !== "other") {
    errors["trade"] = "Select handyman or other.";
  }
  return errors;
}

export function validateSetupStep2(draft: WorkspaceSetupDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  const contactName = requireBoundedName(draft.contact_name, 2, 100);
  const email = validateEmail(draft.contact_email);
  const phone = validateOptionalE164(draft.contact_phone);
  const address = parseUsAddress({
    line1: draft.address_line1,
    line2: draft.address_line2.length > 0 ? draft.address_line2 : null,
    city: draft.city,
    state: draft.state,
    zip: draft.zip,
  });
  if (contactName.error) errors["contact_name"] = contactName.error;
  if (email.error) errors["contact_email"] = email.error;
  if (phone.error) errors["contact_phone"] = phone.error;
  if (address.fieldErrors["address.line1"]?.[0]) errors["address_line1"] = address.fieldErrors["address.line1"][0];
  if (address.fieldErrors["address.line2"]?.[0]) errors["address_line2"] = address.fieldErrors["address.line2"][0];
  if (address.fieldErrors["address.city"]?.[0]) errors["city"] = address.fieldErrors["address.city"][0];
  if (address.fieldErrors["address.state"]?.[0]) errors["state"] = address.fieldErrors["address.state"][0];
  if (address.fieldErrors["address.zip"]?.[0]) errors["zip"] = address.fieldErrors["address.zip"][0];
  return errors;
}

export function validateSetupStep3(draft: WorkspaceSetupDraft): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!draft.timezone_confirmed || !isIanaTimeZone(draft.timezone)) {
    errors["timezone"] = "Confirm the business timezone.";
  }
  const tax = Number(draft.default_tax_bp);
  if (!Number.isInteger(tax) || tax < 0 || tax > 10000) {
    errors["default_tax_bp"] = "Enter tax in basis points from 0 to 10000. This is not tax advice.";
  }
  const due = Number(draft.default_due_days);
  if (!Number.isInteger(due) || due < 0 || due > 365) {
    errors["default_due_days"] = "Enter due days from 0 to 365.";
  }
  const terms = requireOptionalMultiline(draft.default_terms, 4000);
  if (terms.error) errors["default_terms"] = terms.error;
  return errors;
}

export function workspaceCreateBodyFromDraft(draft: WorkspaceSetupDraft): Record<string, unknown> {
  return {
    business_name: draft.business_name,
    legal_name: draft.legal_name,
    contact_name: draft.contact_name,
    contact_email: draft.contact_email,
    contact_phone: draft.contact_phone.trim().length > 0 ? draft.contact_phone : null,
    address: {
      line1: draft.address_line1,
      line2: draft.address_line2.trim().length > 0 ? draft.address_line2 : null,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
    },
    timezone: draft.timezone,
    trade: draft.trade,
    default_tax_bp: Number(draft.default_tax_bp),
    default_due_days: Number(draft.default_due_days),
    default_terms: draft.default_terms,
  };
}
