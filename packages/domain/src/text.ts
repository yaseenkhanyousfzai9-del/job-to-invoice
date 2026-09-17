export function trimOuter(value: string): string {
  return value.trim();
}

export function hasDisallowedControlChars(
  value: string,
  allowNewlines = false,
): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code === 127) {
      return true;
    }
    if (code < 32) {
      if (allowNewlines && (code === 10 || code === 13)) {
        continue;
      }
      return true;
    }
  }
  return false;
}

export function validateBoundedName(
  raw: unknown,
  field: string,
  min: number,
  max: number,
): string {
  if (typeof raw !== "string") {
    return `${field} is required.`;
  }
  const trimmed = trimOuter(raw);
  if (trimmed.length < min || trimmed.length > max) {
    return `${field} must be ${min} to ${max} characters.`;
  }
  if (hasDisallowedControlChars(trimmed)) {
    return `${field} contains unsupported characters.`;
  }
  return "";
}

export function requireBoundedName(
  raw: unknown,
  min: number,
  max: number,
): { value: string; error: string | undefined } {
  if (typeof raw !== "string") {
    return { value: "", error: `Must be ${min} to ${max} characters.` };
  }
  const trimmed = trimOuter(raw);
  if (trimmed.length < min || trimmed.length > max) {
    return { value: trimmed, error: `Must be ${min} to ${max} characters.` };
  }
  if (hasDisallowedControlChars(trimmed)) {
    return { value: trimmed, error: "Contains unsupported characters." };
  }
  return { value: trimmed, error: undefined };
}

export function requireOptionalMultiline(
  raw: unknown,
  max: number,
): { value: string; error: string | undefined } {
  if (raw === undefined || raw === null) {
    return { value: "", error: undefined };
  }
  if (typeof raw !== "string") {
    return { value: "", error: `Must be at most ${max} characters.` };
  }
  if (raw.length > max) {
    return { value: raw, error: `Must be at most ${max} characters.` };
  }
  if (hasDisallowedControlChars(raw, true)) {
    return { value: raw, error: "Contains unsupported characters." };
  }
  return { value: raw, error: undefined };
}
