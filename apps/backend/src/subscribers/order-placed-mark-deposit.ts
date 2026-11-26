import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"

import { PAYMENT_SCHEDULE_MODULE } from "../modules/payment_schedule"
import { deliverDepositReceivedEmail } from "../workflows/designs/deliver-deposit-received-email"

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

    /**
     * A MANUAL deposit (design order) was set before tax and freight were
     * known, so its stored total and balance are from the cart as it was then.
     * Re-base them on the order as placed: the total is the order's, the
     * deposit is what checkout actually collected, and the balance is the
     * difference — the same figure the order will report as outstanding, so
     * `request_order_balance` reconciles instead of refusing.
     */
    // The figures the buyer is told about — re-based below when the order allows.
    let figures = {
      total: Number(schedule.total_due),
      deposit: Number(schedule.deposit_amount),
      balance: Number(schedule.balance_amount),
    }

    if (schedule.source_type === "manual" && schedule.deposit_status === "pending") {
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "total", "currency_code", "payment_collections.amount"],
        filters: { id: data.id },
      })
      const order = orders?.[0] as any
      const total = Number(order?.total)
      const collected = (order?.payment_collections ?? []).reduce(
        (sum: number, c: any) => sum + (Number(c?.amount) || 0),
        0
      )
      // 🔴 #176 (2026-11-26): a 50% deposit order was charged IN FULL and this
      // re-base quietly wrote the full charge in as "the deposit", so nothing
      // looked wrong. Say so loudly. The schedule still records what was
      // really collected (that is the money), but an admin hears about it.
      const pct = Number(schedule.deposit_pct)
      const expected =
        Number.isFinite(pct) && pct > 0 && pct < 100
          ? Math.round(total * pct) / 100
          : null
      if (expected !== null && collected - expected > 0.01) {
        const cur = String(order?.currency_code ?? schedule.currency_code ?? "").toUpperCase()
        const message =
          `Order ${data.id} was meant to take a ${pct}% deposit (${expected} ${cur}) but collected ${collected} ${cur}. ` +
          `The buyer was overcharged by ${Math.round((collected - expected) * 100) / 100} ${cur}. ` +
          `Refund the difference; if a refund turns the order "fully paid", run the reinstate-balance-from-credit-line job.`
        logger.error(`[deposit] OVERCHARGE ${message}`)
        try {
          const notifications: any = container.resolve(Modules.NOTIFICATION)
          await notifications.createNotifications([
            {
              to: "",
              channel: "feed",
              template: "admin-ui",
              data: { title: "Deposit order charged more than its deposit", description: message },
            },
          ])
        } catch (e: any) {
          logger.warn(`[deposit] overcharge feed post failed: ${e?.message ?? e}`)
        }
      }

      if (Number.isFinite(total) && total > 0 && collected > 0 && collected <= total) {
        const balance = Math.round((total - collected) * 100) / 100
        await schedules.updatePaymentSchedules({
          id: schedule.id,
          total_due: total,
          deposit_amount: collected,
          balance_amount: balance,
        })
        figures = { total, deposit: collected, balance }
        logger.info(
          `[deposit] schedule=${schedule.id} re-based on order=${data.id}: total ${total}, deposit ${collected}, balance ${balance}`
        )
      }
    }

    if (schedule.deposit_status === "pending") {
      await schedules.markDepositPaid(schedule.id, data.id)
      logger.info(
        `[deposit] schedule=${schedule.id} deposit marked paid for order=${data.id} (cart=${cartId})`
      )

      /**
       * #2568 — tell a design-order buyer what they paid and that the rest is
       * due after delivery. Only on the pending → paid transition, so a
       * redelivered event (schedule already paid) mails nothing. Manual
       * (design-order) deposits only: a quote's buyer has the quote's terms.
       * The helper never throws and skips when nothing is outstanding (an
       * admin "prepaid" convert captures the full total).
       */
      if (schedule.source_type === "manual") {
        await deliverDepositReceivedEmail(container, {
          orderId: data.id,
          depositAmount: figures.deposit,
          total: figures.total,
          balanceAmount: figures.balance,
        })
      }
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
