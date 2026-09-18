/**
 * Matching an inbound WhatsApp number against the ones we have stored.
 *
 * Extracted because it already existed as two byte-identical private copies —
 * in `whatsapp-message-handler.ts` and `whatsapp-admin-handler.ts` — and #2138
 * needed a third. Three copies of a rule is how one of them quietly becomes the
 * odd one out; this codebase has been there before with `sellsDirect`.
 */

/** WhatsApp sends digits only; stored numbers may carry `+`, spaces or dashes. */
export const digitsOnly = (v: string | null | undefined): string =>
  String(v ?? "").replace(/[^0-9]/g, "")

/**
 * Do these two numbers refer to the same phone?
 *
 * Suffix matching, because the same number reaches us with and without its
 * country code (`919876543210` vs `9876543210`) and neither form is wrong.
 *
 * ⚠️ Deliberately unchanged from the copies it replaces, including its
 * looseness: a very short string suffix-matches many numbers. Callers pass full
 * numbers, so it has not bitten — but this is the place to tighten it if it ever
 * does, which is the point of there being one place.
 */
export function phoneMatches(a: string, b: string): boolean {
  return a === b || a.endsWith(b) || b.endsWith(a)
}
