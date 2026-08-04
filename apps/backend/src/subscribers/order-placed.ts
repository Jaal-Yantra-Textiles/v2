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
import { lineItemIdsNeedingShippingFlag } from "../lib/requires-shipping"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  // Execute the order confirmation email workflow (customer).
  // Non-fatal: a missing/inactive `order-placed` template (or any mail
  // failure) must not abort the handler — production runs and design→order
  // links below are the load-bearing side effects, and an unguarded throw
  // here silently skipped both for the entire order.
  try {
    await sendOrderConfirmationWorkflow(container).run({
      input: {
        orderId: data.id,
      },
    })
  } catch (e: any) {
    logger.warn(
      `[order.placed] Order confirmation email failed for order ${data.id}: ${e?.message || e}`
    )
  }

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

    // #1195: repair the derived `requires_shipping` before anything fulfils
    // this order — but ONLY for items whose product carries a shipping
    // profile. That is the draft-order defect: `createOrderWorkflow` loses the
    // profile between its query step and `prepareLineItemData`, so an item that
    // should derive `true` comes out `false` and the dashboard hides "Mark as
    // shipped".
    //
    // A profile-less product is deliberately NOT touched: `create-fulfillment`
    // rejects a requires-shipping item whose product profile doesn't match the
    // chosen option, so flipping it there would make the order unfulfillable
    // rather than shippable. Those are fixed by giving the product a profile
    // (see the backfill-product-shipping-profiles DP job).
    //
    // Non-fatal, like the email steps above.
    try {
      const { data: graphed } = await query.graph({
        entity: "order",
        fields: [
          "id",
          "items.id",
          "items.requires_shipping",
          "items.product.shipping_profile.id",
        ],
        filters: { id: data.id },
      })
      const needsFlag = lineItemIdsNeedingShippingFlag(graphed?.[0]?.items)
      for (const lineItemId of needsFlag) {
        await orderService.updateOrderLineItems(lineItemId, {
          requires_shipping: true,
        })
      }
      if (needsFlag.length) {
        logger.info(
          `[order.placed] Repaired requires_shipping on ${needsFlag.length} line item(s) of order ${data.id} (#1195)`
        )
      }
    } catch (e: any) {
      logger.warn(
        `[order.placed] requires_shipping repair failed for order ${data.id}: ${e?.message || e}`
      )
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
          // #1126 — a design-backed RETAIL run is provenance, not a partner
          // work-order: don't project it onto the #342 unified view (it would
          // be mis-discriminated as a design work-order). The run is born
          // `pending_review` ("sold, not yet shipped") and is transitioned to
          // `completed` by the fulfillment path once the goods ship from stock.
          skip_unified_projection: true,
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
