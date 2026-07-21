import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { sendOrderFulfillmentEmail } from "../workflows/email/send-notification-email"
import { sendPartnerOrderFulfilledWorkflow } from "../workflows/email/workflows/send-partner-order-email"
import { createProductionRunWorkflow } from "../workflows/production-runs/create-production-run"
import { completeProvenanceRunWorkflow } from "../workflows/production-runs/complete-provenance-run"
import { planLineItemRunAction } from "../lib/plan-fulfillment-production-runs"

// #1112 — "fulfilled from produced stock" ⇒ retroactively mint a COMPLETED
// production run per fulfilled line item, hung off the Product spine, carrying
// order/partner provenance. Runs on `order.fulfillment_created` (the intent
// signal). The per-line decision (create / complete an existing pre-production
// run / skip) lives in the shared `planLineItemRunAction` so this path and the
// historical backfill job (#1122) can never drift or double-create.
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
      const quantity = Number(fi.quantity) || 1

      const plan = await planLineItemRunAction(query, {
        lineItemId,
        productId: orderItem?.product_id,
        variantId: orderItem?.variant_id,
        quantity,
      })
      if (!plan) {
        continue
      }

      // A design-backed run from order.placed that never went through
      // production → the goods shipped from stock, so complete it (#1126)
      // instead of leaving it `pending_review` forever.
      if (plan.action === "complete") {
        await completeProvenanceRunWorkflow(container).run({
          input: {
            production_run_id: plan.production_run_id,
            produced_quantity: plan.quantity,
          },
        })
        logger.info(
          `[order.fulfillment_created] Completed design-backed provenance run ${plan.production_run_id} for line item ${lineItemId} (shipped from stock)`
        )
        continue
      }

      await createProductionRunWorkflow(container).run({
        input: {
          design_id: plan.design_id ?? undefined,
          quantity: plan.quantity,
          produced_quantity: plan.quantity,
          product_id: plan.product_id,
          variant_id: plan.variant_id,
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
            is_custom_design: plan.is_custom_design,
            design_backed: Boolean(plan.design_id),
          },
        },
      })

      logger.info(
        `[order.fulfillment_created] Minted ${
          plan.design_id ? "design-backed" : "product-only"
        } production run for line item ${lineItemId} (product ${plan.product_id})`
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
