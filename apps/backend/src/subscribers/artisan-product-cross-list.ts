import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import partnerProductLink from "../links/partner-product"
import { listStorefronts } from "../api/mcp/lib/store-resolver"
import { decideCrossList } from "./lib/artisan-cross-list-decision"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * #859 S2 (#861) — cross-list an artisan's proposed product onto the core
 * cicilabel.com sales channel once an admin publishes it.
 *
 * An artisan (`core_channel_listing`) partner creates products as `proposed`,
 * bound only to their own channel, with a `partner-product` link recording
 * ownership. When an admin flips the product to `published`, this handler
 * attaches the core store's sales channel so it appears on the core storefront.
 * Non-artisan products (no partner-product link) are ignored, so this stays
 * cheap on the high-frequency `product.updated` event.
 */
export default async function artisanProductCrossListHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!data?.id) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const logger = container.resolve("logger") as any

  // Only artisan-owned products carry a partner-product link. No link → ignore.
  let ownerLinks: any[] = []
  try {
    const res = await query.graph({
      entity: LINK_ENTRY,
      fields: ["partner_id", "product_id"],
      filters: { product_id: data.id },
    })
    ownerLinks = res?.data || []
  } catch (e: any) {
    logger?.warn?.(
      `[artisan cross-list] owner lookup failed for product ${data.id}: ${e.message}`
    )
    return
  }
  if (ownerLinks.length === 0) return

  // Cross-list only once the product is published.
  let product: any
  try {
    const res = await query.graph({
      entity: "product",
      fields: ["id", "status", "sales_channels.id"],
      filters: { id: data.id },
    })
    product = res?.data?.[0]
  } catch (e: any) {
    logger?.warn?.(
      `[artisan cross-list] product lookup failed for ${data.id}: ${e.message}`
    )
    return
  }
  if (!product) return

  // Resolve the core (platform) store's sales channel — the store not owned by
  // any partner (apex cicilabel.com). Reuses the MCP store-resolver.
  let coreChannelId: string | null = null
  try {
    const storefronts = await listStorefronts(container)
    coreChannelId =
      storefronts.find((s) => s.is_default)?.sales_channel_id || null
  } catch (e: any) {
    logger?.warn?.(
      `[artisan cross-list] core channel resolve failed for ${data.id}: ${e.message}`
    )
    return
  }

  const decision = decideCrossList({
    hasOwnerLink: ownerLinks.length > 0,
    status: product.status,
    coreChannelId,
    currentChannelIds: (product.sales_channels || [])
      .map((sc: any) => sc?.id)
      .filter(Boolean),
  })
  if (decision.action === "skip") return

  try {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
    await remoteLink.create({
      [Modules.PRODUCT]: { product_id: data.id },
      [Modules.SALES_CHANNEL]: { sales_channel_id: decision.channelId },
    })
    logger?.info?.(
      `[artisan cross-list] product ${data.id} cross-listed to core channel ${decision.channelId}`
    )
  } catch (e: any) {
    logger?.warn?.(
      `[artisan cross-list] failed to attach product ${data.id} to core channel ${decision.channelId}: ${e.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["product.updated"],
}
