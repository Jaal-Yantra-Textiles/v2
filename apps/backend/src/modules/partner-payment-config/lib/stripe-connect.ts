import { MedusaError } from "@medusajs/framework/utils"

export const STRIPE_PROVIDER_ID = "pp_stripe_stripe"

export type ConnectStatus = "pending" | "active" | "restricted" | "disconnected"

/**
 * Resolve the platform's Stripe client (JYT's own account) — this is the
 * account that owns the connected Standard accounts. Reuses STRIPE_API_KEY,
 * the same secret the partner-subscription checkout already uses.
 *
 * `stripe` is a transitive dependency (resolved via the Medusa stripe
 * provider), so we dynamic-import it exactly like the subscription route does.
 */
export const getPlatformStripe = async (): Promise<any> => {
  const stripeKey = process.env.STRIPE_API_KEY
  if (!stripeKey) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Stripe is not configured on the platform (STRIPE_API_KEY missing)."
    )
  }
  const Stripe = await import("stripe").then((m) => m.default)
  return new Stripe(stripeKey)
}

/**
 * Derive our coarse status enum from a Stripe Account object. Pure — safe to
 * unit test. "active" means the partner can actually accept charges.
 */
export const deriveConnectStatus = (account: {
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
}): ConnectStatus => {
  if (account?.charges_enabled) return "active"
  if (account?.details_submitted) return "restricted"
  return "pending"
}

/**
 * Map a Stripe Account onto the typed columns we persist. Pure.
 */
export const accountToConnectFields = (account: {
  charges_enabled?: boolean
  payouts_enabled?: boolean
  details_submitted?: boolean
}) => ({
  connect_status: deriveConnectStatus(account),
  connect_charges_enabled: !!account?.charges_enabled,
  connect_payouts_enabled: !!account?.payouts_enabled,
  connect_details_submitted: !!account?.details_submitted,
})

/**
 * Whether a config row's connected account is the live/authoritative Stripe
 * source ("Connect wins when active"). When true, the partner's manually
 * entered keys are a fallback only.
 */
export const isConnectLive = (config: {
  connect_account_id?: string | null
  connect_charges_enabled?: boolean | null
}): boolean => !!(config?.connect_account_id && config?.connect_charges_enabled)

const SAFE_URL_PROTOCOLS = new Set(["http:", "https:"])

/**
 * Validate a client-supplied return/refresh URL before handing it to Stripe.
 * Only http(s) — prevents open-redirect / javascript: shenanigans.
 */
export const assertSafeUrl = (url: unknown, label: string): string => {
  if (typeof url !== "string" || !url) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} is required.`
    )
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} must be a valid absolute URL.`
    )
  }
  if (!SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `${label} must be an http(s) URL.`
    )
  }
  return parsed.toString()
}
