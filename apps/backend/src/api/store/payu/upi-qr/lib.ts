/**
 * Pure helpers for generate_upi_qr. Resolve a scannable `upi://pay?...` link
 * from whatever the agent has — an explicit link, a VPA (+ amount/payee), or
 * (in the route) the cart's stored PayU intent. The QR image itself is rendered
 * by the `qrcode` lib in the route; only the link assembly is pure here.
 */
export type UpiLinkInput = {
  upi_link?: string
  vpa?: string
  amount?: number | string
  payee_name?: string
  note?: string
}

/** True for a syntactically-valid UPI deep link. */
export function isUpiLink(s: unknown): s is string {
  return typeof s === "string" && /^upi:\/\//i.test(s.trim())
}

/**
 * Build a `upi://pay` link from a VPA + optional amount/payee/note. Returns null
 * if there's no VPA to anchor it. Amounts are formatted to 2 decimals (UPI wants
 * a plain decimal string); currency is fixed to INR.
 */
export function buildUpiLink(input: UpiLinkInput): string | null {
  const vpa = (input.vpa || "").trim()
  if (!vpa) return null
  const params = new URLSearchParams()
  params.set("pa", vpa)
  if (input.payee_name) params.set("pn", input.payee_name)
  const amt = Number(input.amount)
  if (isFinite(amt) && amt > 0) params.set("am", amt.toFixed(2))
  params.set("cu", "INR")
  if (input.note) params.set("tn", input.note)
  return `upi://pay?${params.toString()}`
}

/**
 * Resolve the final UPI link from agent input: a valid explicit link wins,
 * otherwise build one from a VPA. Returns null when neither is usable (the route
 * then falls back to the cart's stored intent, or 400s).
 */
export function resolveUpiLink(input: UpiLinkInput): string | null {
  if (isUpiLink(input.upi_link)) return input.upi_link!.trim()
  return buildUpiLink(input)
}
