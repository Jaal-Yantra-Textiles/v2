import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import partnerProductLink from "../links/partner-product"
import { decideCrossList } from "./lib/artisan-cross-list-decision"
import { resolveCoreSalesChannelId } from "./lib/resolve-core-sales-channel"

const LINK_ENTRY = partnerProductLink.entryPoint

/**
 * #859 S2 (#861) — cross-list an artisan's approved product onto the core
 * sales channel.
 *
 * An artisan (`core_channel_listing`) partner creates products as `proposed`,
 * bound only to their own channel, with a `partner-product` link recording
 * ownership. An admin reviews and approves via
 * `POST /admin/partners/products/:id/approve`, which publishes the product and
 * emits `partner_product.approved`. This handler reacts to that dedicated
 * event — NOT the high-frequency generic `product.updated` — and attaches the
 * core sales channel so the product appears on the core storefront.
 *
 * The core channel is identified by its sales-channel id (CORE_SALES_CHANNEL_ID
 * env); there is no "core store" entity. See resolve-core-sales-channel.ts.
 *
 * The same `partner_product.approved` event is also available to the visual
 * flow editor (registered in visual-flow-event-trigger.ts), so operators can
 * layer notifications/automations on approval without touching code.
 */
export default async function artisanProductCrossListHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  if (!data?.id) return

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const logger = container.resolve("logger") as any

  // Only artisan-owned products carry a partner-product link. No link → ignore.
  // (The approve endpoint only emits for artisan products, but we re-check so a
  // stray/hand-fired event can't cross-list an unrelated product.)
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

  // Cross-list only once the product is published (approve publishes first).
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

  // Resolve the core sales channel by its id (env-configured), not by guessing
  // a "default" store.
  let coreChannelId: string | null = null
  try {
    coreChannelId = await resolveCoreSalesChannelId(container)
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
  // Dedicated approval event — not the noisy generic product.updated.
  event: ["partner_product.approved"],
}
