import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"

import { requestPostDeliveryFeedbackWorkflow } from "../workflows/feedback/request-post-delivery-feedback"
import { shouldRequestPostDeliveryFeedback } from "../workflows/feedback/lib/post-delivery-feedback"

/**
 * #452 — post-delivery feedback trigger.
 *
 * Runs ALONGSIDE `delivery-created.ts` (which sends the "delivered" shipment
 * email). On delivery it creates an idempotent pending feedback request tied
 * to the order and emails the customer a feedback link (backend trigger only;
 * the storefront rating UX is a later slice).
 *
 * Best-effort: a missing template / unconfigured store URL / provider error
 * must never break delivery processing.
 */
export default async function orderDeliveredFeedbackHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  const decision = shouldRequestPostDeliveryFeedback({
    eventNoNotification: data.no_notification,
  })
  if (!decision.request) {
    return
  }

  try {
    await requestPostDeliveryFeedbackWorkflow(container).run({
      input: { shipment_id: data.id },
    })
  } catch (e: any) {
    logger.warn(
      `[delivery.created] post-delivery feedback request failed: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}
