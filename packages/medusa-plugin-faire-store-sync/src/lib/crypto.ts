import crypto from "crypto"

/**
 * Symmetric encryption for secrets at rest (Faire OAuth access/refresh tokens).
 *
 * AES-256-GCM, mirroring the host app's `encryption` module so the same
 * `ENCRYPTION_KEY` protects Faire tokens the same way it protects social
 * platform tokens. A dedicated `FAIRE_TOKEN_ENCRYPTION_KEY` takes precedence
 * if set.
 *
 * Stored format (single self-describing string, fits the existing text column):
 *   fenc1:<iv_b64>.<authTag_b64>.<ciphertext_b64>
 *
 * Backward/forward compatible:
 *   - `encryptSecret`  of an empty/nullish value returns it unchanged.
 *   - `decryptSecret`  of a value WITHOUT the `fenc1:` prefix is returned as-is,
 *     so legacy plaintext rows keep working and a missing key degrades to
 *     plaintext (with a one-time warning) rather than crashing.
 */

const PREFIX = "fenc1:"
const ALGORITHM = "aes-256-gcm"

let warnedNoKey = false

/** Resolve a 32-byte key from whatever secret is configured (any length). */
function resolveKey(): Buffer | null {
  const keyString =
    process.env.FAIRE_TOKEN_ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY ||
    process.env.ENCRYPTION_KEY_V1
  if (!keyString) return null

  // Prefer a base64 32-byte key (matches the host encryption module); otherwise
  // derive a stable 32-byte key from the secret so any value works.
  const asBase64 = Buffer.from(keyString, "base64")
  if (asBase64.length === 32) return asBase64
  return crypto.createHash("sha256").update(keyString, "utf8").digest()
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext == null || plaintext === "") {
    return plaintext ?? null
  }
  const key = resolveKey()
  if (!key) {
    if (!warnedNoKey) {
      // eslint-disable-next-line no-console
      console.warn(
        "[faire-sync] No ENCRYPTION_KEY/FAIRE_TOKEN_ENCRYPTION_KEY set — Faire tokens are stored in plaintext. Set one to encrypt at rest."
      )
      warnedNoKey = true
    }
    return plaintext
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`
}

export function decryptSecret(stored: string | null | undefined): string {
  if (stored == null || stored === "") return ""
  if (!stored.startsWith(PREFIX)) return stored // legacy plaintext / unencrypted
  const key = resolveKey()
  if (!key) {
    throw new Error(
      "[faire-sync] Encrypted Faire token found but no ENCRYPTION_KEY/FAIRE_TOKEN_ENCRYPTION_KEY is set to decrypt it."
    )
  }
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(".")
  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const ct = Buffer.from(ctB64, "base64")
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}

/** True if the stored value is in the encrypted envelope format. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(PREFIX)
}
