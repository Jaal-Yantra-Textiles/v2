import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, Logger } from "@medusajs/types"
import { sendOrderConfirmationWorkflow } from "../workflows/email/send-notification-email"
import { sendPartnerOrderPlacedWorkflow } from "../workflows/email/workflows/send-partner-order-email"
import { createProductionRunWorkflow } from "../workflows/production-runs/create-production-run"
import { linkDesignsToOrder } from "../workflows/designs/link-designs-to-order"
import {
  hasProductionRunForLineItem,
  resolveLineItemDesignId,
} from "../lib/resolve-line-item-production"

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
      if (await hasProductionRunForLineItem(query, lineItemId)) {
        continue
      }

      // Resolve the design (variant-level custom design takes priority over the
      // product-level association). Shared with the fulfillment path (#1112).
      const { designId, isCustomDesign } = await resolveLineItemDesignId(query, {
        productId,
        variantId,
      })

      if (isCustomDesign) {
        logger.info(
          `[order.placed] Found custom design ${designId} for variant ${variantId}`
        )
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
