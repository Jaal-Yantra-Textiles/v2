/**
 * Keys a STORE caller may never put into payment-session data (#2574).
 *
 * The PayU provider reads these as facts: the status, PayU's ids, `txnid` (the
 * one PayU's verify_payment is asked about) and which merchant account to
 * verify against. Medusa stores a new session as {...callerData, ...provider},
 * so any key the provider does not itself return survives from the caller. A
 * buyer must not be able to supply them. Server code (a paid link's
 * completion) sets `txnid` itself with updatePaymentSession.
 */
export const RESERVED_PAYU_SESSION_KEYS = [
  "payu_status",
  "status",
  "mihpayid",
  "txnid",
  "hash",
  "payu_hash",
  "payu_amount",
  "verified",
  "partner_merchant_key",
  "partner_merchant_salt",
  "partner_mode",
] as const

export function stripReservedPayuSessionKeys(
  data?: Record<string, unknown> | null
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) }
  for (const k of RESERVED_PAYU_SESSION_KEYS) delete out[k]
  return out
}
