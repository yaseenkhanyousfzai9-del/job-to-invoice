const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * Lookup normalization (VAL01 / DEC-CUST-008).
 * Trim, split on the last "@", then Unicode case-fold local part and domain.
 * Do not remove dots, plus-tags, or other local-part characters.
 * The stored display email is the trimmed original, not this lookup form.
 */
export function normalizeEmail(displayEmail: string): string {
  const trimmed = displayEmail.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return trimmed.toLowerCase();
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  return `${local.toLowerCase()}@${domain.toLowerCase()}`;
}

export function validateEmail(raw: unknown): {
  display: string;
  normalized: string;
  error: string | undefined;
} {
  if (typeof raw !== "string") {
    return { display: "", normalized: "", error: "Enter a valid email." };
  }
  const display = raw.trim();
  if (display.length === 0) {
    return { display: "", normalized: "", error: "Enter a valid email." };
  }
  if (display.length > 254) {
    return { display, normalized: "", error: "Email must be at most 254 characters." };
  }
  if (!EMAIL_PATTERN.test(display)) {
    return { display, normalized: "", error: "Enter a valid email." };
  }
  return { display, normalized: normalizeEmail(display), error: undefined };
}

export function validateOptionalEmail(raw: unknown): {
  display: string | null;
  normalized: string | null;
  error: string | undefined;
} {
  if (raw === undefined || raw === null) {
    return { display: null, normalized: null, error: undefined };
  }
  if (typeof raw !== "string") {
    return { display: null, normalized: null, error: "Enter a valid email." };
  }
  if (raw.trim().length === 0) {
    return { display: null, normalized: null, error: undefined };
  }
  const parsed = validateEmail(raw);
  if (parsed.error) {
    return { display: parsed.display, normalized: null, error: parsed.error };
  }
  return { display: parsed.display, normalized: parsed.normalized, error: undefined };
}

export function maskEmail(displayEmail: string): string {
  const trimmed = displayEmail.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) {
    return "your email";
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 1);
  return `${visible}•••@${domain}`;
}
