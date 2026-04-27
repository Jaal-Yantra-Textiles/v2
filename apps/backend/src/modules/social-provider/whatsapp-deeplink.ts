import jwt from "jsonwebtoken"

const DEEPLINK_EXPIRY = "24h"
const DEEPLINK_ISSUER = "jyt-whatsapp"

interface DeeplinkPayload {
  partner_id: string
  run_id?: string
  type: "production_run" | "design" | "portal"
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

  let path = ""
  switch (payload.type) {
    case "production_run":
      path = `/production-runs/${cleanRunId}`
      break
    case "design":
      path = `/designs/${cleanRunId}`
      break
    case "portal":
      path = "/"
      break
  }

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
