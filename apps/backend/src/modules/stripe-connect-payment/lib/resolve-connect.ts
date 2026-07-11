import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { parseFeePercent } from "./fee"
import partnerRegionLink from "../../../links/partner-region"

/**
 * The provider id that stores a partner's connected-account config AND is the
 * standard (platform-keys) Stripe checkout provider. Dual role — see #838.
 */
export const CONNECT_CONFIG_PROVIDER_ID = "pp_stripe_stripe"

/** The standard Stripe checkout provider (platform keys). Alias for clarity. */
export const STANDARD_STRIPE_PROVIDER_ID = "pp_stripe_stripe"

/** The Stripe Connect checkout provider (routes into the merchant's account). */
export const CONNECT_CHECKOUT_PROVIDER_ID = "pp_stripe-connect_stripe-connect"

export type ResolvedPartnerConnect = {
  partner_id: string
  connect_account_id: string
  fee_percent: number
}

/**
 * Resolve a storefront's owning partner + active Stripe connected account +
 * plan-derived application-fee fraction, from a cart's sales channel.
 *
 * MUST be called from a request/workflow scope (route, workflow, subscriber) —
 * NOT from inside the payment provider, whose isolated module container has no
 * access to `query` or other modules. The result is passed to the provider via
 * the payment-session `context`, keeping the provider free of cross-module deps.
 *
 * Returns null when there is no owning partner or no charge-enabled account
 * ("Connect wins when active").
 */
export const resolvePartnerConnect = async (
  scope: any,
  salesChannelId: string | undefined,
  defaultFeePercent = 0
): Promise<ResolvedPartnerConnect | null> => {
  if (!salesChannelId) return null

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: stores } = await query
    .graph({
      entity: "store",
      filters: { default_sales_channel_id: salesChannelId },
      fields: ["id", "partner.id"],
    })
    .catch(() => ({ data: [] }))

  const partnerId = stores?.[0]?.partner?.id
  if (!partnerId) return null

  const configService = scope.resolve("partner_payment_config")
  const configs = await configService.listPartnerPaymentConfigs({
    partner_id: partnerId,
    provider_id: CONNECT_CONFIG_PROVIDER_ID,
    is_active: true,
  })
  const config = configs?.[0]
  if (!config?.connect_account_id || !config?.connect_charges_enabled) {
    return null
  }

  // Application fee % from the partner's active plan.
  let feePercent = defaultFeePercent
  const { data: subs } = await query
    .graph({
      entity: "partner_subscription",
      filters: { partner_id: partnerId, status: "active" },
      fields: ["id", "plan.features"],
    })
    .catch(() => ({ data: [] }))
  const feeRaw = subs?.[0]?.plan?.features?.payment_processing_fee
  if (feeRaw != null) {
    const pct = parseFeePercent(feeRaw)
    if (pct > 0) feePercent = pct
  }

  return {
    partner_id: partnerId,
    connect_account_id: config.connect_account_id,
    fee_percent: feePercent,
  }
}

/**
 * Build the payment-session context fragment carrying the resolved connected
 * account down to the provider. Spread into `createPaymentSessionsWorkflow`'s
 * `input.context`. Empty when there's nothing to route.
 */
export const connectContext = (
  resolved: ResolvedPartnerConnect | null
): Record<string, unknown> =>
  resolved
    ? {
        connect_account_id: resolved.connect_account_id,
        connect_partner_id: resolved.partner_id,
        connect_fee_percent: resolved.fee_percent,
      }
    : {}

/**
 * Whether the partner that OWNS a given region has an active Stripe Connect
 * account (onboarded + charges enabled).
 *
 * Drives the buyer-facing `/store/payment-providers` override (#985): the single
 * "Stripe" a shopper sees is chosen by the *owning partner's* Connect status,
 * NOT the region's currency. This is what fixes an India partner's EU-region
 * storefront surfacing Stripe Connect — India partners are never Connect-onboarded
 * (`isStripeConnectEligible` is EUR-only, #838), so this returns false for them
 * and the standard platform-Stripe provider is shown instead.
 *
 * Region → owning partner via the `partner_region` link. A region with no owning
 * partner (the core store) → false → standard Stripe. Best-effort: any lookup
 * failure resolves to false (safe default — never surface Connect on a doubt).
 */
export const resolvePartnerConnectedByRegion = async (
  scope: any,
  regionId: string | undefined
): Promise<boolean> => {
  if (!regionId) return false

  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query
    .graph({
      entity: partnerRegionLink.entryPoint,
      filters: { region_id: regionId },
      fields: ["partner_id"],
    })
    .catch(() => ({ data: [] }))

  const partnerId = links?.[0]?.partner_id
  if (!partnerId) return false

  try {
    const configService = scope.resolve("partner_payment_config")
    const configs = await configService.listPartnerPaymentConfigs({
      partner_id: partnerId,
      provider_id: CONNECT_CONFIG_PROVIDER_ID,
      is_active: true,
    })
    const config = configs?.[0]
    return !!(config?.connect_account_id && config?.connect_charges_enabled)
  } catch {
    return false
  }
}

/**
 * PURE: collapse the two Stripe providers into a single buyer-facing "Stripe",
 * choosing which one to keep by the owning partner's Connect status. Non-Stripe
 * providers pass through untouched, order preserved. Exported for unit testing.
 *
 *   • connected  → keep Connect provider, drop standard
 *   • not         → keep standard provider, drop Connect
 *
 * The loser is only dropped when the intended winner is actually present, so a
 * region that happens to have only one of the two Stripe providers is never
 * left with zero Stripe options.
 */
export const dedupeStripeProviders = <T extends { id?: string | null }>(
  providers: T[],
  connected: boolean
): T[] => {
  const winner = connected ? CONNECT_CHECKOUT_PROVIDER_ID : STANDARD_STRIPE_PROVIDER_ID
  const loser = connected ? STANDARD_STRIPE_PROVIDER_ID : CONNECT_CHECKOUT_PROVIDER_ID
  const list = providers || []
  const hasWinner = list.some((p) => p?.id === winner)
  if (!hasWinner) return list
  return list.filter((p) => p?.id !== loser)
}
