import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { reconcileProvenanceRunsForOrderLines } from "../lib/reconcile-provenance-runs"

// #1123 — a canceled order voids its retail provenance runs: nothing produced
// for it ever shipped, so the trail must not claim otherwise. Reconcile every
// line item with `voided: true` (cumulative forced to 0), which soft-deletes the
// runs THIS system minted. Real production runs (design work-orders) are left
// alone. A separate subscriber (not folded into the existing order-canceled
// email handler) so provenance stays isolated from notifications.
export default async function orderCanceledProvenanceRunsHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.id"],
      filters: { id: data.id },
    })
    const lineItemIds: string[] = ((orders || [])[0]?.items || [])
      .map((it: any) => it?.id)
      .filter(Boolean)
    if (!lineItemIds.length) return

    await reconcileProvenanceRunsForOrderLines(
      container,
      { orderId: data.id, lineItemIds, voided: true },
      logger
    )
  } catch (e: any) {
    logger.warn(
      `[order.canceled] Failed to void provenance runs for order ${data.id}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
