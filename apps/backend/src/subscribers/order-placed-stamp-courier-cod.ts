import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"

import { stampCourierCodOrder } from "../lib/cod/stamp-courier-cod-order"

/**
 * A courier cash-on-delivery order must say so, or its parcel is booked
 * prepaid and the courier collects nothing (2026-11-27). See
 * `lib/cod/stamp-courier-cod-order.ts`.
 *
 * A subscriber, not completeCart's `orderCreated` hook: Medusa allows one
 * handler per hook and the loyalty plugin already owns that one.
 *
 * 🔴 A failure here is LOGGED LOUDLY, not swallowed quietly: an unstamped COD
 * order ships without collecting. The admin must stamp it by hand
 * (`metadata.payment_mode = "cod"`) before booking.
 */
export default async function stampCourierCodOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  try {
    const outcome = await stampCourierCodOrder(container, data.id)
    if (outcome === "stamped") {
      logger.info(`[courier-cod] order ${data.id} stamped payment_mode=cod`)
    }
  } catch (e: any) {
    logger.error(
      `[courier-cod] FAILED to check/stamp order ${data.id} as COD — if it was ` +
        `placed as cash on delivery, set metadata.payment_mode="cod" before booking a courier: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
