import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const BTCPAY_CONFIG_PROVIDER_ID = "pp_btcpay_btcpay"

/**
 * A partner storefront's BTCPay store id, from its active
 * partner_payment_config row (`provider_id = pp_btcpay_btcpay`,
 * `credentials.store_id`). The store id is NOT a secret: one API key on our
 * BTCPay account covers every store, and webhook secrets are derived.
 *
 * No partner, no active row, or no store id → null, and the provider uses OUR
 * store (BTCPAY_SERVER_ID): the sale lands in our wallet.
 *
 * Call from a request/workflow scope — providers can't query (see the PayU
 * twin, resolve-partner-creds.ts).
 */
export async function resolvePartnerBtcpayStore(
  scope: any,
  salesChannelId: string | undefined
): Promise<{ partner_id: string; store_id: string } | null> {
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

  const configs = await scope.resolve("partner_payment_config").listPartnerPaymentConfigs({
    partner_id: partnerId,
    provider_id: BTCPAY_CONFIG_PROVIDER_ID,
    is_active: true,
  })
  const storeId = String(configs?.[0]?.credentials?.store_id || "").trim()
  return storeId ? { partner_id: partnerId, store_id: storeId } : null
}

export function btcpayContext(resolved: { partner_id: string; store_id: string } | null): Record<string, unknown> {
  return resolved ? { btcpay_store_id: resolved.store_id, btcpay_partner_id: resolved.partner_id } : {}
}
