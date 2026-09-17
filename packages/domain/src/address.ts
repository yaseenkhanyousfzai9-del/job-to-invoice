import { hasDisallowedControlChars } from "./text.ts";

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

export type UsState = (typeof US_STATES)[number];

export type UsAddress = {
  line1: string;
  line2: string | null;
  city: string;
  state: UsState;
  zip: string;
};

const ZIP_PATTERN = /^\d{5}(-\d{4})?$/;
const STATE_SET = new Set<string>(US_STATES);

function lineError(raw: unknown, field: string, max: number, required: boolean): { value: string; error: string | undefined } {
  if (raw === undefined || raw === null || raw === "") {
    return {
      value: "",
      error: required ? `${field} is required.` : undefined,
    };
  }
  if (typeof raw !== "string") {
    return { value: "", error: `${field} must be text.` };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: "", error: required ? `${field} is required.` : undefined };
  }
  if (trimmed.length > max) {
    return { value: trimmed, error: `${field} must be at most ${max} characters.` };
  }
  if (hasDisallowedControlChars(trimmed)) {
    return { value: trimmed, error: `${field} contains unsupported characters.` };
  }
  return { value: trimmed, error: undefined };
}

export function parseUsAddress(raw: unknown): {
  value: UsAddress | undefined;
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    fieldErrors["address"] = ["Enter a US business address."];
    return { value: undefined, fieldErrors };
  }
  const body = raw as Record<string, unknown>;
  const allowed = new Set(["line1", "line2", "city", "state", "zip"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      fieldErrors[key] = ["Unknown field."];
    }
  }

  const line1 = lineError(body["line1"], "Address line 1", 150, true);
  const line2 = lineError(body["line2"], "Address line 2", 150, false);
  const city = lineError(body["city"], "City", 80, true);
  const stateRaw = typeof body["state"] === "string" ? body["state"].trim().toUpperCase() : "";
  const zipRaw = typeof body["zip"] === "string" ? body["zip"].trim() : "";

  if (line1.error) fieldErrors["address.line1"] = [line1.error];
  if (line2.error) fieldErrors["address.line2"] = [line2.error];
  if (city.error) fieldErrors["address.city"] = [city.error];
  if (!STATE_SET.has(stateRaw)) {
    fieldErrors["address.state"] = ["Select a two-letter US state."];
  }
  if (!ZIP_PATTERN.test(zipRaw)) {
    fieldErrors["address.zip"] = ["Enter a 5-digit ZIP or ZIP+4."];
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { value: undefined, fieldErrors };
  }

  return {
    value: {
      line1: line1.value,
      line2: line2.value.length > 0 ? line2.value : null,
      city: city.value,
      state: stateRaw as UsState,
      zip: zipRaw,
    },
    fieldErrors,
  };
}
