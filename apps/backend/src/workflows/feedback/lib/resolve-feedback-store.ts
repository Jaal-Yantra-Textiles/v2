import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { partnerStorefrontOrigin } from "../../../lib/carts/recovery-link"
import { resolveFeedbackStoreBase } from "./post-delivery-feedback"

/**
 * Which shop a buyer's feedback link (and the feedback page) belongs to.
 *
 * A buyer who ordered from a partner's store must land on THAT store's domain,
 * so the page carries the partner's brand. Same hop the cart links use
 * (`resolveCartCheckoutLink`): order.sales_channel_id → the store whose default
 * sales channel it is → its partner → `partnerStorefrontOrigin` (verified
 * custom domain, else the provisioned subdomain).
 *
 * Our own orders (no partner store) fall back to `resolveFeedbackStoreBase`
 * (override → STORE_URL → …). Never throws: a lookup failure falls back.
 */
export type FeedbackStore = {
  /** Trailing-slash-trimmed origin the link is built on ("" when none). */
  origin: string
  /** Partner's store name, or null for our own shop. */
  store_name: string | null
  source: "override" | "partner" | "fallback"
}

export async function resolveFeedbackStoreForOrder(
  container: any,
  input: { orderId?: string | null; salesChannelId?: string | null; override?: string | null }
): Promise<FeedbackStore> {
  const env = process.env as Record<string, string | undefined>
  if (input.override && input.override.trim()) {
    return {
      origin: resolveFeedbackStoreBase(env, input.override),
      store_name: null,
      source: "override",
    }
  }

  const fallback: FeedbackStore = {
    origin: resolveFeedbackStoreBase(env),
    store_name: null,
    source: "fallback",
  }

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    let salesChannelId = input.salesChannelId ?? null
    if (!salesChannelId && input.orderId) {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "sales_channel_id"],
        filters: { id: input.orderId },
      })
      salesChannelId = (orders?.[0] as any)?.sales_channel_id ?? null
    }
    if (!salesChannelId) return fallback

    const { data: stores } = await query.graph({
      entity: "store",
      filters: { default_sales_channel_id: salesChannelId },
      fields: [
        "id",
        "name",
        "partner.id",
        "partner.name",
        "partner.storefront_domain",
        "partner.custom_domain",
        "partner.custom_domain_verified",
      ],
    })
    // Exactly one store owns a default sales channel; more than one is a data
    // problem we must not resolve by picking `[0]`.
    if (!stores || stores.length !== 1) return fallback
    const store: any = stores[0]
    const partner = store?.partner ?? null
    const origin = partnerStorefrontOrigin(partner)
    if (!partner || !origin) return fallback

    return {
      origin,
      store_name: store?.name || partner?.name || null,
      source: "partner",
    }
  } catch {
    return fallback
  }
}
