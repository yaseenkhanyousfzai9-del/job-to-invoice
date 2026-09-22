import { isUuid } from "@job-to-invoice/domain";

/**
 * Idempotency-Key must be a UUID. Some Android/Hermes runtimes lack crypto.randomUUID.
 * Fall back to an RFC 4122 version-4 UUID that still passes domain isUuid().
 */
export function createClientUuid(): string {
  try {
    if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
      const value = globalThis.crypto.randomUUID();
      if (isUuid(value)) {
        return value;
      }
    }
  } catch {
    // fall through to manual v4
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // RFC 4122 version 4 + variant 10xx
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
