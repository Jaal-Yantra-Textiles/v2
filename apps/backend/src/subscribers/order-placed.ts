import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, Logger } from "@medusajs/types"
import { sendOrderConfirmationWorkflow } from "../workflows/email/send-notification-email"
import { sendPartnerOrderPlacedWorkflow } from "../workflows/email/workflows/send-partner-order-email"
import { createProductionRunWorkflow } from "../workflows/production-runs/create-production-run"
import { linkDesignsToOrder } from "../workflows/designs/link-designs-to-order"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  // Execute the order confirmation email workflow (customer)
  await sendOrderConfirmationWorkflow(container).run({
    input: {
      orderId: data.id,
    },
  })

  // Notify the partner (if order belongs to a partner store)
  try {
    await sendPartnerOrderPlacedWorkflow(container).run({
      input: { orderId: data.id },
    })
  } catch (e: any) {
    logger.warn(
      `[order.placed] Partner notification failed for order ${data.id}: ${e?.message || e}`
    )
  }

  try {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const order: any = await orderService.retrieveOrder(data.id, {
      relations: ["items"],
    })

    const items: any[] = order?.items || []
    if (!items.length) {
      return
    }

    for (const item of items) {
      const lineItemId = item?.id
      const productId = item?.product_id
      const variantId = item?.variant_id
      const quantity = item?.quantity

      if (!lineItemId || !productId) {
        continue
      }

      // Idempotency: if we already created a production run for this line item, skip
      const { data: existing } = await query.graph({
        entity: "production_runs",
        fields: ["id"],
        filters: { order_line_item_id: lineItemId },
        pagination: { skip: 0, take: 1 },
      })
      const existingRuns = existing || []
      if (existingRuns.length) {
        continue
      }

      let designId: string | null = null
      let isCustomDesign = false

      // First, check for design-variant link (custom designs created via design editor)
      // This takes priority as it's a direct link to the specific design
      if (variantId) {
        const { data: variantDesignLinks } = await query.graph({
          entity: "design_product_variant",
          fields: ["design_id", "customer_id", "estimated_cost"],
          filters: { product_variant_id: variantId },
          pagination: { skip: 0, take: 1 },
        })

        const variantLink = (variantDesignLinks || [])[0]
        if (variantLink?.design_id) {
          designId = variantLink.design_id
          isCustomDesign = true
          logger.info(
            `[order.placed] Found custom design ${designId} for variant ${variantId}`
          )
        }
      }

      // If no variant-level link, check product-level link (standard product-design association)
      if (!designId) {
        const { data: productDesignLinks } = await query.graph({
          entity: "product_design",
          fields: ["design.*"],
          filters: { product_id: productId },
          pagination: { skip: 0, take: 1 },
        })

        const link = (productDesignLinks || [])[0]
        const design = link?.design
        designId = design?.id || null
      }

      if (!designId) {
        logger.info(
          `[order.placed] No design linked to product ${productId} (variant ${variantId}) — skipping production run creation for line item ${lineItemId}`
        )
        continue
      }

      await createProductionRunWorkflow(container).run({
        input: {
          design_id: designId,
          quantity,
          product_id: productId,
          variant_id: variantId,
          order_id: order?.id,
          order_line_item_id: lineItemId,
          metadata: {
            source: "order.placed",
            is_custom_design: isCustomDesign,
          },
        },
      })
    }
  } catch (e: any) {
    logger.warn(
      `[order.placed] Failed to create production runs for order ${data.id}: ${e?.message || e}`
    )
  }

  // Create design → order links (order → order_cart → cart line items →
  // design_line_item). Lives in linkDesignsToOrder so the backfill script
  // shares the exact same traversal.
  try {
    const { linked } = await linkDesignsToOrder(container, data.id)
    if (linked > 0) {
      logger.info(
        `[order.placed] Linked ${linked} design(s) to order ${data.id}`
      )
    }
  } catch (e: any) {
    logger.warn(
      `[order.placed] Failed to create design-order links for order ${data.id}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
