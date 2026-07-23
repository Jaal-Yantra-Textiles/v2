import crypto from "crypto"

/**
 * Mint a high-entropy invite token. The `raw` value goes in the invite URL and
 * is shown to the caller exactly once; only `hash` is persisted.
 */
export function generateInviteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url")
  return { raw, hash: hashInviteToken(raw) }
}

export function hashInviteToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

/**
 * An invite is usable when it is still pending and (if dated) not yet expired.
 * Pure — callers pass the current time so it stays testable/deterministic.
 */
export function isInviteUsable(
  invite: { status: string; expires_at?: Date | string | null },
  now: Date
): boolean {
  if (invite.status !== "pending") return false
  if (invite.expires_at && new Date(invite.expires_at).getTime() <= now.getTime()) {
    return false
  }
  return true
}
