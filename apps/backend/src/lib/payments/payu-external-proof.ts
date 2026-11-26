import crypto from "crypto"

/**
 * A server-only signature that says "our own code verified this PayU txn and
 * chose to complete a cart with it" (#2574).
 *
 * Why it exists: a paid PayU *link* completes its cart by creating a session on
 * the PayU provider. Medusa stores that session as
 * `{ ...callerData, ...initiatePayment().data }`, so the provider's fresh txnid
 * overwrites the link's real one. Any other key in session data is writable by
 * the buyer too (POST /store/payment-collections/:id/payment-sessions takes
 * `data`). So the provider cannot tell a txnid our webhook verified from one a
 * buyer typed in — unless it carries a signature only this server can make.
 *
 * The provider still re-verifies the txnid with PayU and checks the amount; the
 * proof only decides WHICH txnid it is allowed to look at.
 */

export const PAYU_EXTERNAL_TXNID_KEY = "payu_external_txnid"
export const PAYU_EXTERNAL_PROOF_KEY = "payu_external_proof"

function proofSecret(): string | null {
  const s = process.env.PAYU_EXTERNAL_PROOF_SECRET || process.env.COOKIE_SECRET || process.env.JWT_SECRET
  return s && s.length >= 8 ? s : null
}

function sign(secret: string, txnid: string): string {
  return crypto.createHmac("sha256", secret).update(`payu-external|${txnid}`).digest("hex")
}

/** Session-data fields that let the provider authorize against `txnid`. */
export function mintPayuExternalProof(txnid: string): Record<string, string> {
  const secret = proofSecret()
  if (!secret || !txnid) return {}
  return { [PAYU_EXTERNAL_TXNID_KEY]: txnid, [PAYU_EXTERNAL_PROOF_KEY]: sign(secret, txnid) }
}

/** The externally-verified txnid in `data`, only if its proof is genuine. */
export function readPayuExternalTxnid(data?: Record<string, unknown> | null): string | null {
  const txnid = data?.[PAYU_EXTERNAL_TXNID_KEY]
  const proof = data?.[PAYU_EXTERNAL_PROOF_KEY]
  const secret = proofSecret()
  if (!secret || typeof txnid !== "string" || !txnid || typeof proof !== "string") return null
  const expected = sign(secret, txnid)
  if (proof.length !== expected.length) return null
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(proof)) ? txnid : null
}

/**
 * Keys a STORE caller may never put into payment-session data. The provider
 * reads these as facts (status, PayU ids, which merchant account to verify
 * against, the external proof), so a buyer must not be able to supply them.
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
  PAYU_EXTERNAL_TXNID_KEY,
  PAYU_EXTERNAL_PROOF_KEY,
] as const

export function stripReservedPayuSessionKeys(
  data?: Record<string, unknown> | null
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(data ?? {}) }
  for (const k of RESERVED_PAYU_SESSION_KEYS) delete out[k]
  return out
}
