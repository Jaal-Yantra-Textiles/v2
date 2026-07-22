import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { reconcileProvenanceRunsForOrderLines } from "../lib/reconcile-provenance-runs"

// #1123 — a canceled fulfillment means its stock never shipped. Reconcile the
// affected line items: the reconcile recomputes the cumulative fulfilled qty
// across the order's NON-canceled fulfillments, so the provenance run either
// drops to the reduced qty (line still partly fulfilled) or is soft-deleted
// (nothing left shipped). Only runs THIS system minted are touched.
export default async function orderFulfillmentCanceledHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  order_id: string
  fulfillment_id: string
  no_notification?: boolean
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    // The line items the canceled fulfillment covered.
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
  } catch (e: any) {
    logger.warn(
      `[order.fulfillment_canceled] Failed to reconcile provenance runs for order ${data.order_id}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_canceled",
}
