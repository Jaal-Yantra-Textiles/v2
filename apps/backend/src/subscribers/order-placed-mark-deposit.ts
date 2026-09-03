import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"

import { PAYMENT_SCHEDULE_MODULE } from "../modules/payment_schedule"

/**
 * Close the first half of a quote's payment schedule when its order is placed
 * (#1451).
 *
 * ## Why a subscriber and not the completion routes
 *
 * A cart completes on three paths: the PayU complete route, the PayU
 * external-completion helper, and — for Stripe — core's own payment webhook,
 * which never touches our code at all. Wiring the routes would leave the Stripe
 * rail unmarked, and "the deposit is recorded on two of three rails" is a
 * ledger nobody can trust. `order.placed` is the one event all three reach.
 *
 * ## Why the schedule methods were safe to call but had never run
 *
 * `attachOrder` and `markDepositPaid` have existed on the service since the
 * schedule was built and had **zero callers** — the ledger was opened at
 * acceptance and then never advanced by anything. `markDepositPaid` is already
 * idempotent against its own state (a gateway webhook is delivered at least
 * once), which is what makes it safe to call from an event that can be
 * redelivered.
 *
 * 🔑 Non-fatal throughout. A schedule that fails to advance must not take down
 * order placement — the money has already moved by the time this runs, and an
 * unmarked ledger is a reporting problem, while a thrown subscriber is a
 * customer problem.
 */
export default async function markDepositPaidOnOrderPlaced({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    /**
     * 🔴 Read the link through its OWN entry point, not as a field on `order`.
     * `query.graph({ entity: "order", fields: ["cart.id"] })` returns no key at
     * all — silently, with no error — which reads as "this order has no cart"
     * and would make every deposit look unpaid.
     */
    const { data: links } = await query.graph({
      entity: "order_cart",
      fields: ["order_id", "cart_id"],
      filters: { order_id: data.id },
    })
    const cartId = links?.[0]?.cart_id
    if (!cartId) {
      return
    }

    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByCartId(cartId)
    if (!schedule) {
      // The overwhelming majority of orders: an ordinary cart with no deposit.
      return
    }

    // Attach FIRST. If marking the deposit then fails, the schedule is at least
    // findable from the order, which is what a human needs to finish the job by
    // hand. The reverse order leaves a paid deposit floating with no order.
    if (!schedule.order_id) {
      await schedules.attachOrder(schedule.id, data.id)
    }

    if (schedule.deposit_status === "pending") {
      await schedules.markDepositPaid(schedule.id, data.id)
      logger.info(
        `[deposit] schedule=${schedule.id} deposit marked paid for order=${data.id} (cart=${cartId})`
      )
    }
  } catch (e: any) {
    logger.warn(
      `[deposit] Could not advance the payment schedule for order ${data.id}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
