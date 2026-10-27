import crypto from "crypto"

/** Days an approval link stays usable. */
export const APPROVAL_TTL_DAYS = 14

export function generateApprovalToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url")
  return { raw, hash: hashApprovalToken(raw) }
}

export function hashApprovalToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export function approvalExpiryFrom(now: Date, days = APPROVAL_TTL_DAYS): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
}
