import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PAYMENT_SCHEDULE_MODULE } from "../modules/payment_schedule"
import { requestOrderBalanceWorkflow } from "../workflows/payments/request-order-balance"

/**
 * Raise the balance when the goods actually move (#1451 follow-on).
 *
 * ## Why dispatch, and why this is not the only trigger
 *
 * The balance becomes payable when the goods exist. A partner can say so by
 * hand (`POST /partners/orders/:id/request-balance`) because they often know
 * before the system does — but the reliable, unattended signal is the shipment
 * itself. Both paths run the SAME workflow, which is idempotent: whichever
 * happens first wins and the second is a no-op, so a partner who pressed the
 * button an hour earlier does not end up with two collections.
 *
 * ## What it emits, and why a flow rather than an email here
 *
 * On success it emits `order.balance_due` carrying the amount and the pay link.
 * `visual-flow-event-trigger` already listens for shipment and delivery events,
 * so the REMINDER is a visual flow an operator can edit — wording, timing,
 * channel — rather than a template buried in a subscriber. This subscriber's
 * only job is to make the money collectable and publish the fact.
 *
 * 🔴 Never throws. A fulfilment must not fail because a payment schedule could
 * not be raised — the goods are already going out, and the sweep plus the
 * partner button both remain as recovery.
 */
export default async function raiseBalanceOnDispatch({
  event,
  container,
}: SubscriberArgs<{ id: string; order_id?: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  /**
   * 🔴 The payload differs by event, and getting this wrong fails SILENTLY.
   *
   * `order.fulfillment_created` carries the ORDER id. `shipment.created` and
   * `delivery.created` carry the FULFILMENT id — verified against
   * `delivery-created.ts`, which passes `data.id` straight in as a
   * `shipment_id`. Treating that as an order id would make
   * `findByOrderId(<fulfilment id>)` return nothing on every shipment, and the
   * subscriber would look healthy while raising no balance at all.
   *
   * So a non-order event is resolved through `fulfillment → order.id` first.
   */
  const isOrderEvent = event.name === "order.fulfillment_created"
  let orderId: string | null =
    (event.data as any)?.order_id ?? (isOrderEvent ? event.data?.id : null) ?? null

  if (!orderId && event.data?.id) {
    try {
      const { data } = await query.graph({
        entity: "fulfillment",
        fields: ["id", "order.id"],
        filters: { id: event.data.id },
      })
      orderId = (data?.[0] as any)?.order?.id ?? null
    } catch (e: any) {
      logger?.warn?.(
        `[balance] could not resolve an order from fulfilment ${event.data.id}: ${
          e?.message ?? e
        }`
      )
    }
  }

  if (!orderId) return

  try {
    const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
    const schedule = await schedules.findByOrderId(orderId)

    // No schedule means an ordinary order with nothing outstanding. Silence is
    // correct here; this fires on every shipment on the platform.
    if (!schedule) return
    if (schedule.balance_status !== "not_due") return

    const { result } = await requestOrderBalanceWorkflow(container).run({
      input: { order_id: orderId, requested_by: "dispatch" },
    })

    const out = result as any
    if (!out?.raised) {
      logger?.info?.(
        `[balance] dispatch of order=${orderId} did not raise a balance: ${
          out?.plan?.reason ?? "no reason given"
        }`
      )
      return
    }

    const eventBus: any = container.resolve(Modules.EVENT_BUS)
    await eventBus.emit({
      name: "order.balance_due",
      data: {
        id: orderId,
        order_id: orderId,
        payment_schedule_id: out.plan?.schedule_id ?? schedule.id,
        amount: out.plan?.collectable ? out.plan.amount : null,
        currency_code: out.plan?.collectable ? out.plan.currency_code : null,
        // The link the reminder should carry. A flow that renders the email
        // needs this — without it the buyer gets a demand and no way to pay.
        pay_url: out.pay_url ?? null,
      },
    })

    logger?.info?.(
      `[balance] raised on dispatch for order=${orderId} — ${
        out.plan?.collectable ? out.plan.amount : "?"
      } due, link ${out.pay_url ?? "unavailable"}`
    )
  } catch (e: any) {
    logger?.error?.(
      `[balance] failed to raise on dispatch for order=${orderId}: ${e?.message ?? e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["shipment.created", "delivery.created", "order.fulfillment_created"],
}
