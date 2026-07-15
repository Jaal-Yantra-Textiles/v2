import { createHmac } from "node:crypto";

/** Normalize a name for tolerant comparison: upper, strip punctuation, collapse ws. */
export function normalizeName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** Token-set Jaccard similarity (0..1) — order-insensitive, tolerant to extra tokens. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter(Boolean));
  const tb = new Set(normalizeName(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Pull a display name out of a masked census record without hardcoding one key —
 * the public record shape varies, so take the first string field whose key looks
 * name-ish (and isn't obviously something else).
 */
export function extractName(rec: Record<string, any>): string | null {
  for (const [k, v] of Object.entries(rec)) {
    if (
      typeof v === "string" &&
      /name/iu.test(k) &&
      !/user|file|scheme|district|state|village|block/iu.test(k)
    ) {
      return v;
    }
  }
  return null;
}

/** Normalize Aadhaar to its 12 digits. */
export function normalizeAadhaar(s: string): string {
  return s.replace(/\D/gu, "");
}

/**
 * HMAC-SHA256 the Aadhaar with a server-side pepper so the value is never stored
 * or logged in the clear. Pepper from CENSUS_AADHAAR_PEPPER (falls back to the
 * general handloom key, or a dev constant) — set a dedicated one in prod.
 */
export function hashAadhaar(aadhaar: string): string {
  const pepper =
    process.env.CENSUS_AADHAAR_PEPPER ||
    process.env.HANDLOOM_ENCRYPTION_KEY ||
    "dev-only-unsafe-pepper";
  return createHmac("sha256", pepper).update(normalizeAadhaar(aadhaar)).digest("hex");
}
