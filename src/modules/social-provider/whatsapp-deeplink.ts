import jwt from "jsonwebtoken"

const DEEPLINK_EXPIRY = "24h"
const DEEPLINK_ISSUER = "jyt-whatsapp"

interface DeeplinkPayload {
  partner_id: string
  run_id?: string
  type: "production_run" | "design" | "portal"
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

  const token = jwt.sign(
    {
      sub: payload.partner_id,
      run_id: payload.run_id,
      type: payload.type,
      iss: DEEPLINK_ISSUER,
    },
    secret,
    { expiresIn: DEEPLINK_EXPIRY }
  )

  let path = ""
  switch (payload.type) {
    case "production_run":
      path = `/production-runs/${payload.run_id}`
      break
    case "design":
      path = `/designs/${payload.run_id}`
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
