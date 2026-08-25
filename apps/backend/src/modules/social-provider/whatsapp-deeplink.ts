import jwt from "jsonwebtoken"

const DEEPLINK_EXPIRY = "24h"
const DEEPLINK_ISSUER = "jyt-whatsapp"

/**
 * What a deep-link can point at.
 *
 * 🔑 `inquiry` (#1531 slice 3) is the first type that is not a piece of work
 * already assigned — it is an ASK, sent to several partners at once, before
 * anything is ordered. That is exactly why it needs the one-tap link: a
 * partner who has to remember a password to answer a question they did not ask
 * for simply does not answer, and the whole feature exists to end that silence.
 */
export type PartnerDeeplinkType =
  | "production_run"
  | "design"
  | "portal"
  | "inquiry"

interface DeeplinkPayload {
  partner_id: string
  /**
   * The resource the link opens.
   *
   * ⚠️ Named `run_id` because that is the claim already on the wire and in
   * every token issued in the last 24 hours; it carries whatever id the `type`
   * addresses — a run, a design, and now an inquiry. Renaming the claim would
   * silently break every link already sitting in a partner's WhatsApp thread.
   */
  run_id?: string
  type: PartnerDeeplinkType
}

/**
 * PURE: where a deep-link of this type lands in the partner portal.
 *
 * ## 🔴 Why this is a function and not two switch statements
 *
 * It WAS two. `generatePartnerDeeplink` had a `switch` and
 * `/partners/wa-auth` had an `if/else` chain, written months apart, and both
 * had to agree or the partner is authenticated and then dropped somewhere
 * else. Adding a type to one and forgetting the other produces a link that
 * works — it just quietly lands on the portal home instead of the thing the
 * message was about, and the partner has no idea they were meant to see
 * anything.
 *
 * That is #1529 exactly: a guard and a releaser written months apart,
 * disagreeing about which field says what to do, with the disagreement showing
 * up as nothing happening. Two places that must agree will drift unless they
 * call the same function.
 *
 * Unknown types fall back to the portal root rather than throwing. A link that
 * lands somewhere useful beats a 500 in a partner's browser — but every type
 * in the union is covered here, so the fallback is for tokens issued by an
 * older deploy, not for a type nobody wired up.
 */
export function partnerDeeplinkPath(
  type: string | null | undefined,
  resourceId?: string | null
): string {
  const id = stripDedupSuffix(resourceId ?? undefined)
  if (!id) return "/"

  switch (type) {
    case "production_run":
      return `/production-runs/${id}`
    case "design":
      return `/designs/${id}`
    case "inquiry":
      // Mirrors the partner-ui route added in slice 2
      // (get-partner-route.map.tsx → `/inquiries/:id`).
      return `/inquiries/${id}`
    default:
      return "/"
  }
}

/**
 * The reminder dispatcher uses synthetic ids of the form
 *   "<run_id>:reminder:<YYYY-MM-DD>"
 * as a per-day dedup key (so the same reminder doesn't fire twice on the
 * same day). That synthetic id has been leaking into the deep-link URL
 * and the JWT's `run_id` claim, which means even if auth worked, the
 * partner-ui's /production-runs/:id route gets the synthetic value and
 * 404s.
 *
 * Strip everything from the first colon onwards as a defensive measure
 * — production-run / design IDs are ULIDs and never contain colons in
 * the canonical form, so this is a safe trim regardless of upstream.
 */
function stripDedupSuffix(id: string | undefined): string | undefined {
  if (!id) return id
  const colonIdx = id.indexOf(":")
  return colonIdx >= 0 ? id.slice(0, colonIdx) : id
}

/**
 * Generate a short-lived JWT token for WhatsApp deep-links.
 * Partners can click the link and land in the portal without logging in.
 */
export function generatePartnerDeeplink(
  payload: DeeplinkPayload,
  baseUrl: string
): { url: string; token: string } {
  const secret = getSecret()
  const cleanRunId = stripDedupSuffix(payload.run_id)

  const token = jwt.sign(
    {
      sub: payload.partner_id,
      run_id: cleanRunId,
      type: payload.type,
      iss: DEEPLINK_ISSUER,
    },
    secret,
    { expiresIn: DEEPLINK_EXPIRY }
  )

  // One path builder, shared with /partners/wa-auth. See its docblock.
  const path = partnerDeeplinkPath(payload.type, cleanRunId)

  const url = `${baseUrl}${path}?wa_token=${token}`

  return { url, token }
}

/**
 * Verify a deep-link token and return the payload.
 * Returns null if the token is invalid or expired.
 */
export function verifyPartnerDeeplink(
  token: string
): { partnerId: string; runId?: string; type: string } | null {
  try {
    const secret = getSecret()
    const decoded = jwt.verify(token, secret, {
      issuer: DEEPLINK_ISSUER,
    }) as any

    return {
      partnerId: decoded.sub,
      runId: decoded.run_id,
      type: decoded.type,
    }
  } catch {
    return null
  }
}

function getSecret(): string {
  return process.env.JWT_SECRET || "supersecret"
}
