/**
 * Pull a sensible INR amount suggestion out of free-form WhatsApp text.
 *
 * Used by the "Create payment request from message" admin action: when a
 * partner messages a number ("can you pay 1500 for last week"), we want
 * to pre-fill the modal so the operator just confirms instead of
 * retyping. Kept conservative — returns undefined whenever the match is
 * ambiguous so we don't plant a wrong number in the input.
 *
 * Accepts: 1500, 1,500, ₹1500, ₹1,500, 1,500/-, INR 1500, Rs 1500,
 *          1500 rupees
 *
 * Rejects: short standalone numbers (<3 digits) without a currency
 *          marker — too noisy ("ok 12 photos done").
 */
export function extractSuggestedAmount(text?: string | null): number | undefined {
  if (!text) return undefined
  // Three branches in priority order:
  //   1. <currency>NUM     "₹1500", "Rs. 1,500.50", "INR 1500"
  //   2. NUM<currency>     "1500 rupees", "12000 rs"
  //   3. bare NUM (3+ digits)  "1500", "12,345.50"
  // Decimal must be inside the capture group so e.g. "12,345.50" yields
  // "12,345.50" not "12,345" + dropped ".50".
  const match = text.match(
    /(?:₹|inr|rs\.?)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:rs|rupees|inr)\b|(?<![\d.])([\d,]{3,}(?:\.\d+)?)(?![\d])/i,
  )
  if (!match) return undefined
  const raw = match[1] ?? match[2] ?? match[3]
  if (!raw) return undefined
  const num = Number(raw.replace(/,/g, ""))
  if (!Number.isFinite(num) || num <= 0 || num > 10_000_000) return undefined
  return num
}
