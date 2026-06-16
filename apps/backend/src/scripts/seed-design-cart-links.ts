import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../modules/designs"
import designLineItemLink from "../links/design-line-item-link"
import designOrderLink from "../links/design-order-link"

/**
 * Dev-only seed: backfill the design↔cart-line-item link for existing design
 * work-orders so they appear in the admin "Design Orders" page (which keys off
 * `design_design_cart_line_item`). The base seed creates orders directly and
 * skips the storefront checkout / draft-order workflow that normally writes this
 * link, leaving the Design Orders page empty locally. This recreates that link
 * (cart + custom-priced line item + design↔line_item) for a couple of designs
 * already linked to a work-status order, so the #403 work-status badge on the
 * Design Orders detail page can be verified end-to-end.
 *
 * Run: npx medusa exec ./src/scripts/seed-design-cart-links.ts
 */
export default async function seedDesignCartLinks({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const cartService = container.resolve(Modules.CART) as any
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

  // Designs already linked to an order carrying a partner work-status.
  const DESIGN_IDS = [
    "01KV3YTNTVSY5N2PZD6SQAADD9", // → completed
    "01KV5D3HKBF5F83WV8HPW1M43W", // → in_progress
  ]

  // Resolve region + sales channel once.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
  })
  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  })
  let salesChannelId = stores?.[0]?.default_sales_channel_id
  if (!salesChannelId) {
    const { data: scs } = await query.graph({ entity: "sales_channel", fields: ["id"] })
    salesChannelId = scs?.[0]?.id
  }

  for (const designId of DESIGN_IDS) {
    // Idempotent: skip if the cart-line-item link already exists.
    const { data: existing } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { design_id: designId },
      fields: ["line_item_id"],
    })
    if (existing?.length) {
      logger.info(`[seed-design-cart-links] ${designId} already linked; skipping`)
      continue
    }

    const { data: designs } = await query.graph({
      entity: "design",
      filters: { id: designId },
      fields: ["id", "name"],
    })
    const design = designs?.[0]
    if (!design) {
      logger.warn(`[seed-design-cart-links] design ${designId} not found; skipping`)
      continue
    }

    // The order this design is already linked to (for currency + customer).
    const { data: orderLinks } = await query.graph({
      entity: designOrderLink.entryPoint,
      filters: { design_id: designId },
      fields: ["order_id", "order.currency_code", "order.customer_id", "order.email"],
    })
    const order = orderLinks?.[0]?.order
    const currencyCode = order?.currency_code || regions?.[0]?.currency_code || "inr"
    const region =
      regions?.find((r: any) => r.currency_code === currencyCode) || regions?.[0]

    const cart = await cartService.createCarts({
      region_id: region?.id,
      currency_code: currencyCode,
      customer_id: order?.customer_id ?? undefined,
      email: order?.email ?? undefined,
      sales_channel_id: salesChannelId,
      metadata: { created_by: "seed", source: "design-order" },
    })

    const lineItems = await cartService.addLineItems(cart.id, [
      {
        title: design.name,
        unit_price: 1200,
        is_custom_price: true,
        requires_shipping: false,
        quantity: 1,
        metadata: { design_id: designId, cost_confidence: "seed" },
      },
    ])

    await remoteLink.create([
      {
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CART]: { line_item_id: lineItems[0].id },
      },
    ])

    logger.info(
      `[seed-design-cart-links] linked design ${designId} → line_item ${lineItems[0].id} (cart ${cart.id})`
    )
  }

  logger.info("[seed-design-cart-links] done")
}
