import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { sendOrderFulfillmentEmail } from "../workflows/email/send-notification-email"
import { sendPartnerOrderFulfilledWorkflow } from "../workflows/email/workflows/send-partner-order-email"
import { reconcileProvenanceRunsForOrderLines } from "../lib/reconcile-provenance-runs"

// #1112 / #1123 — "fulfilled from produced stock" ⇒ retroactively mint a
// COMPLETED production run per fulfilled line item, hung off the Product spine,
// carrying order/partner provenance. Runs on `order.fulfillment_created`.
//
// Delegates to the shared `reconcileProvenanceRunsForOrderLines`, which stamps
// each run's produced_quantity from the CUMULATIVE fulfilled qty across all of
// the order's non-canceled fulfillments (so a partial 4-then-6 fulfillment ends
// at 10, not 4). The same reconcile drives the fulfillment-canceled and
// order-canceled paths, so the three can never drift or double-create.
async function createFulfillmentProductionRuns(
  container: SubscriberArgs<any>["container"],
  data: { order_id: string; fulfillment_id: string },
  logger: Logger
): Promise<void> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  // Which line items did THIS fulfillment cover.
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "items.line_item_id"],
    filters: { id: data.fulfillment_id },
  })
  const lineItemIds: string[] = ((fulfillments || [])[0]?.items || [])
    .map((fi: any) => fi?.line_item_id)
    .filter(Boolean)
  if (!lineItemIds.length) return

  await reconcileProvenanceRunsForOrderLines(
    container,
    { orderId: data.order_id, lineItemIds },
    logger
  )
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
