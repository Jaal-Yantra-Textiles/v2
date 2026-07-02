import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { parseFeePercent } from "./fee"

export const CONNECT_CONFIG_PROVIDER_ID = "pp_stripe_stripe"

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
