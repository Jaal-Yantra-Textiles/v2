import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export const PAYU_CONFIG_PROVIDER_ID = "pp_payu_payu"

export type ResolvedPayuCredentials = {
  partner_id: string
  merchant_key: string
  merchant_salt: string
  mode?: "test" | "live"
}

/**
 * Resolve the sales channel a payment collection belongs to, by walking the
 * core `cart_payment_collection` link back to its cart. The store
 * payment-sessions route only receives a collection id, but partner resolution
 * keys off the cart's sales channel.
 */
export const resolveSalesChannelForCollection = async (
  scope: any,
  collectionId: string
): Promise<string | undefined> => {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: links } = await query
    .graph({
      entity: "cart_payment_collection",
      filters: { payment_collection_id: collectionId },
      fields: ["cart_id"],
    })
    .catch(() => ({ data: [] }))

  const cartId = links?.[0]?.cart_id
  if (!cartId) return undefined

  const { data: carts } = await query
    .graph({
      entity: "cart",
      filters: { id: cartId },
      fields: ["sales_channel_id"],
    })
    .catch(() => ({ data: [] }))

  return carts?.[0]?.sales_channel_id
}

/**
 * Resolve a storefront's owning partner's PayU merchant credentials from a
 * cart's sales channel.
 *
 * MUST be called from a request/workflow scope (route, workflow, subscriber) —
 * NOT from inside the PayU payment provider, whose isolated module container
 * has no access to `query` or other modules. The result is passed to the
 * provider via the payment-session `context`. Mirrors the Stripe Connect
 * `resolvePartnerConnect` pattern.
 *
 * Returns null when there is no owning partner or no active PayU config with
 * usable credentials — in which case the provider keeps using the platform's
 * global PayU credentials.
 */
export const resolvePartnerPayuCredentials = async (
  scope: any,
  salesChannelId: string | undefined
): Promise<ResolvedPayuCredentials | null> => {
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
    provider_id: PAYU_CONFIG_PROVIDER_ID,
    is_active: true,
  })
  const creds = configs?.[0]?.credentials
  if (!creds?.merchant_key || !creds?.merchant_salt) return null

  return {
    partner_id: partnerId,
    merchant_key: creds.merchant_key,
    merchant_salt: creds.merchant_salt,
    mode: creds.mode,
  }
}

/**
 * Build the payment-session context fragment carrying partner PayU credentials
 * down to the provider. Spread into `createPaymentSessionsWorkflow`'s
 * `input.context`. Empty when there's no partner-specific config to route to.
 */
export const payuContext = (
  resolved: ResolvedPayuCredentials | null
): Record<string, unknown> =>
  resolved
    ? {
        payu_partner_id: resolved.partner_id,
        payu_merchant_key: resolved.merchant_key,
        payu_merchant_salt: resolved.merchant_salt,
        ...(resolved.mode ? { payu_mode: resolved.mode } : {}),
      }
    : {}
