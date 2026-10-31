import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { requestOrderBalanceWorkflow } from "../../workflows/payments/request-order-balance"
import { sendNotificationEmailWorkflow } from "../../workflows/email/workflows/send-notification-email"
import { buildBalancePayUrl } from "./balance-collection"
import {
  buildOrderInvoiceVars,
  planScheduleResync,
  type OrderInvoiceVars,
  type ScheduleResyncPlan,
} from "./order-invoice"

export const ORDER_INVOICE_TEMPLATE = "order-invoice"

export type SendOrderInvoiceResult = {
  sent: boolean
  preview: boolean
  to: string | null
  resync: ScheduleResyncPlan
  vars: OrderInvoiceVars
}

/**
 * Email the buyer an itemised invoice with the balance and its pay link.
 *
 * Order of operations matters:
 *  1. Move the schedule's balance to the order's pending difference when an
 *     edit changed it (`planScheduleResync`). Without this the balance workflow
 *     refuses, and the hosted page looks for a collection of the old amount.
 *  2. Raise (or re-raise) the balance. `requestOrderBalanceWorkflow` runs core's
 *     create-OR-UPDATE collection workflow with the schedule's amount, so an
 *     outstanding collection minted for the old figure is moved to the new
 *     one, and an already-raised balance keeps its link: the buyer's URL does
 *     not change.
 *  3. Send. The email goes last, so a refusal above never mails a link that
 *     would charge the wrong amount.
 *
 * `preview` writes nothing and sends nothing; it returns what would happen.
 */
export async function sendOrderInvoice(
  container: MedusaContainer,
  input: { order_id: string; preview?: boolean }
): Promise<SendOrderInvoiceResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)

  const readOrder = async () => {
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "total",
        "item_total",
        "subtotal",
        "shipping_total",
        "summary",
        "items.*",
        "shipping_address.*",
        "billing_address.*",
        "customer.first_name",
      ],
      filters: { id: input.order_id },
    })
    const order = data?.[0]
    if (!order) {
      throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} not found`)
    }
    return order as any
  }

  let order = await readOrder()
  let schedule: any = await schedules.findByOrderId(input.order_id)
  const resync = planScheduleResync({ schedule, order })

  if (resync.action === "refuse" && !input.preview) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, resync.reason)
  }

  const backendUrl =
    process.env.MEDUSA_BACKEND_URL || process.env.BACKEND_URL || "https://v3.jaalyantra.com"
  let payUrl: string | null =
    schedule?.balance_link_ref ?? (schedule ? buildBalancePayUrl(backendUrl, schedule.id) : null)

  if (input.preview) {
    return {
      sent: false,
      preview: true,
      to: order.email ?? null,
      resync,
      vars: buildOrderInvoiceVars({ order, pay_url: payUrl }),
    }
  }

  if (!order.email) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order ${input.order_id} has no email address to send the invoice to.`
    )
  }

  if (resync.action === "resync") {
    await schedules.updatePaymentSchedules({
      id: resync.schedule_id,
      total_due: resync.total_due,
      balance_amount: resync.balance_amount,
    })
    container
      .resolve(ContainerRegistrationKeys.LOGGER)
      .info(`[invoice] order=${input.order_id} schedule=${resync.schedule_id}: ${resync.reason}`)
  }

  if (schedule) {
    const pending = Number(order?.summary?.pending_difference)
    if (Number.isFinite(pending) && pending > 0) {
      const { result } = await requestOrderBalanceWorkflow(container).run({
        input: { order_id: input.order_id, requested_by: "admin:invoice" },
      })
      payUrl = (result as any)?.pay_url ?? payUrl
    }
    // Re-read so the email states the figures as they now stand.
    order = await readOrder()
    schedule = await schedules.findByOrderId(input.order_id)
  }

  const vars = buildOrderInvoiceVars({ order, pay_url: payUrl })

  await sendNotificationEmailWorkflow(container).run({
    input: {
      to: order.email,
      template: ORDER_INVOICE_TEMPLATE,
      data: vars as unknown as Record<string, any>,
    } as any,
  })

  return { sent: true, preview: false, to: order.email, resync, vars }
}
