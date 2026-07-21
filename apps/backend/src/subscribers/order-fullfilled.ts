import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { sendOrderFulfillmentEmail } from "../workflows/email/send-notification-email"
import { sendPartnerOrderFulfilledWorkflow } from "../workflows/email/workflows/send-partner-order-email"
import { createProductionRunWorkflow } from "../workflows/production-runs/create-production-run"
import { completeProvenanceRunWorkflow } from "../workflows/production-runs/complete-provenance-run"
import {
  getProductionRunForLineItem,
  resolveLineItemDesignId,
} from "../lib/resolve-line-item-production"

// #1126 — a run created at order.placed that is still in one of these
// pre-production states means no production actually happened: the goods
// shipped from stock. On fulfillment we transition it to `completed` (rather
// than skipping) so design-backed retail provenance doesn't stay
// `pending_review` forever. Runs already past this point (real production
// underway) are left untouched.
const PRE_PRODUCTION_STATUSES = new Set(["draft", "pending_review"])

// #1112 — "fulfilled from produced stock" ⇒ retroactively mint a COMPLETED
// production run per fulfilled line item, hung off the Product spine, carrying
// order/partner provenance. Runs on `order.fulfillment_created` (the intent
// signal). Idempotent with the payment path (`order.placed`) via the shared
// `order_line_item_id` guard, so design-backed products (whose run was already
// created at payment) are skipped here and never double-created.
async function createFulfillmentProductionRuns(
  container: SubscriberArgs<any>["container"],
  data: { order_id: string; fulfillment_id: string },
  logger: Logger
): Promise<void> {
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    // Which line items (and how many) did THIS fulfillment cover.
    const { data: fulfillments } = await query.graph({
      entity: "fulfillment",
      fields: ["id", "items.line_item_id", "items.quantity"],
      filters: { id: data.fulfillment_id },
    })
    const fulfillment = (fulfillments || [])[0]
    const fulfilledItems: any[] = (fulfillment?.items || []).filter(
      (fi: any) => fi?.line_item_id
    )
    if (!fulfilledItems.length) {
      return
    }

    // Resolve line_item_id → { product_id, variant_id } from the order.
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "items.id",
        "items.product_id",
        "items.variant_id",
      ],
      filters: { id: data.order_id },
    })
    const order = (orders || [])[0]
    const itemById = new Map<string, any>(
      (order?.items || []).map((it: any) => [it.id, it])
    )

    for (const fi of fulfilledItems) {
      const lineItemId = fi.line_item_id as string
      const orderItem = itemById.get(lineItemId)
      const productId = orderItem?.product_id as string | undefined
      const variantId = orderItem?.variant_id as string | undefined
      const quantity = Number(fi.quantity) || 1

      // No product to hang the run off → nothing to provenance.
      if (!productId) {
        continue
      }

      // Shared idempotency with order.placed. If a run already exists it was
      // minted at payment for a design-backed line. When it's still
      // pre-production the goods shipped from stock, so complete it here (#1126)
      // — otherwise it would stay `pending_review` forever. A run already in
      // production is left alone.
      const existingRun = await getProductionRunForLineItem(query, lineItemId)
      if (existingRun) {
        if (PRE_PRODUCTION_STATUSES.has(existingRun.status)) {
          await completeProvenanceRunWorkflow(container).run({
            input: {
              production_run_id: existingRun.id,
              produced_quantity: quantity,
            },
          })
          logger.info(
            `[order.fulfillment_created] Completed design-backed provenance run ${existingRun.id} for line item ${lineItemId} (shipped from stock)`
          )
        }
        continue
      }

      // Reuse the design-resolution traversal; falls through to the product-only
      // path (design_id null) when the product has no backing design.
      const { designId, isCustomDesign } = await resolveLineItemDesignId(query, {
        productId,
        variantId,
      })

      await createProductionRunWorkflow(container).run({
        input: {
          design_id: designId ?? undefined,
          quantity,
          produced_quantity: quantity,
          product_id: productId,
          variant_id: variantId,
          order_id: data.order_id,
          order_line_item_id: lineItemId,
          // Born terminal — the goods are already produced & shipping.
          status: "completed",
          // Provenance runs are not partner work-orders; don't project them
          // onto the unified #342 order (would mis-discriminate the retail
          // order as a design work-order).
          skip_unified_projection: true,
          metadata: {
            source: "order.fulfillment_created",
            fulfillment_id: data.fulfillment_id,
            is_custom_design: isCustomDesign,
            design_backed: Boolean(designId),
          },
        },
      })

      logger.info(
        `[order.fulfillment_created] Minted ${
          designId ? "design-backed" : "product-only"
        } production run for line item ${lineItemId} (product ${productId})`
      )
    }
  } catch (e: any) {
    logger.warn(
      `[order.fulfillment_created] Failed to create production runs for order ${data.order_id}: ${e?.message || e}`
    )
  }
}

export default async function orderFulfillment_createdHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  order_id: string,
  fulfillment_id: string,
  no_notification: boolean
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  // #1112 — provenance run creation runs regardless of notification suppression.
  await createFulfillmentProductionRuns(container, data, logger)

  // Skip notification if explicitly disabled
  if (data.no_notification) {
    return
  }

  // Send the order fulfillment email to customer
  await sendOrderFulfillmentEmail(container).run({
    input: {
      order_id: data.order_id,
      fulfillment_id: data.fulfillment_id,
    },
  })

  // Notify the partner
  try {
    await sendPartnerOrderFulfilledWorkflow(container).run({
      input: { orderId: data.order_id },
    })
  } catch (e: any) {
    logger.warn(
      `[order.fulfillment_created] Partner notification failed: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
