const E164_PATTERN = /^\+[1-9]\d{1,14}$/;

/** Optional phone: omitted is valid. Supplied values must already be E.164. No country guessing. */

export function validateOptionalE164(raw: unknown): {
  value: string | null;
  error: string | undefined;
} {
  if (raw === undefined || raw === null) {
    return { value: null, error: undefined };
  }
  if (typeof raw !== "string") {
    return { value: null, error: "Enter a valid phone in E.164 format, or leave it blank." };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: null, error: undefined };
  }
  if (!E164_PATTERN.test(trimmed)) {
    return {
      value: null,
      error: "Enter a valid phone in E.164 format (for example +15551234567), or leave it blank.",
    };
  }
  return { value: trimmed, error: undefined };
}
