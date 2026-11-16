import crypto from "crypto"

/**
 * Capability tokens for the storefront design chat (#2543).
 *
 * The design chat is a GUEST flow: a maker is identified by nothing more than
 * an email they typed. Before this, every design-scoped action trusted either
 * a bare `design_id` (pick, generate, get_design_state, save_moodboard) or a
 * bare email (conversations, board read) — so anyone who could name a design
 * id or a maker's email could read the board, rewrite the pick, burn image
 * generations on it, or read the whole chat transcript.
 *
 * A design access token is minted the moment a design is created for (or
 * attached to) the session, and is the capability every later design-scoped
 * call must present. Stateless: an HMAC over the ids, no table, no expiry —
 * possession of the token is the grant, exactly like the product preview
 * share link (`store/products/preview/lib/token.ts`).
 *
 * Format (versioned so the scheme can rotate without guessing):
 *
 *   dt1.<design_id>.<customer_id | "-">.<base64url hmac-sha256>
 *   ct1.<conversation_id>.<base64url hmac-sha256>
 *
 * The HMAC key is DERIVED from the server secret with a purpose label, so a
 * design token can never verify as any other JWT_SECRET-signed artefact (and
 * vice versa), and a conversation token can never pass as a design token.
 *
 * Secret: `DESIGN_ACCESS_TOKEN_SECRET` if set, else the JWT_SECRET Medusa
 * already requires in every deployed environment, else COOKIE_SECRET. No new
 * env var is required. Rotating JWT_SECRET invalidates every outstanding
 * design token (makers see "this design belongs to another session").
 */

export const DESIGN_TOKEN_VERSION = "dt1"
export const CONVERSATION_TOKEN_VERSION = "ct1"

/** Ids we sign are Medusa ids / ULIDs — never a dot, never whitespace. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/
const NO_CUSTOMER = "-"

const rawSecret = (): string => {
  const secret =
    process.env.DESIGN_ACCESS_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    process.env.COOKIE_SECRET
  if (secret) return secret
  if (process.env.NODE_ENV === "production") {
    // Never sign capabilities with a public default in production.
    throw new Error(
      "Design access tokens need JWT_SECRET (or DESIGN_ACCESS_TOKEN_SECRET) to be set."
    )
  }
  // Same dev default Medusa itself falls back to (medusa-config.ts).
  return "supersecret"
}

const keyFor = (purpose: string): Buffer =>
  crypto
    .createHash("sha256")
    .update(`jyt:${purpose}:v1|`)
    .update(rawSecret())
    .digest()

const sign = (purpose: string, payload: string): string =>
  crypto.createHmac("sha256", keyFor(purpose)).update(payload).digest("base64url")

const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

// ── Design tokens ─────────────────────────────────────────────────────────

export type DesignAccessClaims = {
  design_id: string
  /** The guest/registered customer the design was minted for, if known. */
  customer_id: string | null
}

export const mintDesignAccessToken = (
  designId: string,
  customerId?: string | null
): string => {
  if (!ID_PATTERN.test(designId)) {
    throw new Error("Cannot mint a design token for a malformed design id.")
  }
  const customer = customerId && ID_PATTERN.test(customerId) ? customerId : NO_CUSTOMER
  const payload = `${DESIGN_TOKEN_VERSION}.${designId}.${customer}`
  return `${payload}.${sign("design-access", payload)}`
}

/**
 * Verify a design token. Returns its claims, or null when it is missing,
 * malformed, tampered with, or — when `expectedDesignId` is given — minted for
 * a different design.
 */
export const verifyDesignAccessToken = (
  token: unknown,
  expectedDesignId?: string | null
): DesignAccessClaims | null => {
  if (typeof token !== "string" || token.length > 400) return null
  const parts = token.split(".")
  if (parts.length !== 4) return null
  const [version, designId, customer, provided] = parts
  if (version !== DESIGN_TOKEN_VERSION) return null
  if (!ID_PATTERN.test(designId)) return null
  if (customer !== NO_CUSTOMER && !ID_PATTERN.test(customer)) return null

  const expected = sign("design-access", `${version}.${designId}.${customer}`)
  if (!safeEqual(provided, expected)) return null
  if (expectedDesignId != null && expectedDesignId !== designId) return null

  return {
    design_id: designId,
    customer_id: customer === NO_CUSTOMER ? null : customer,
  }
}

// ── Conversation tokens ───────────────────────────────────────────────────

export const mintConversationAccessToken = (conversationId: string): string => {
  if (!ID_PATTERN.test(conversationId)) {
    throw new Error("Cannot mint a conversation token for a malformed id.")
  }
  const payload = `${CONVERSATION_TOKEN_VERSION}.${conversationId}`
  return `${payload}.${sign("design-conversation-access", payload)}`
}

export const verifyConversationAccessToken = (
  token: unknown,
  expectedConversationId: string
): boolean => {
  if (typeof token !== "string" || token.length > 300) return false
  const parts = token.split(".")
  if (parts.length !== 3) return false
  const [version, id, provided] = parts
  if (version !== CONVERSATION_TOKEN_VERSION) return false
  if (id !== expectedConversationId || !ID_PATTERN.test(id)) return false
  return safeEqual(provided, sign("design-conversation-access", `${version}.${id}`))
}
