import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import * as Handlebars from "handlebars"

import { BOT_SUPPRESSED_SEND_ID } from "../bot-recipients"
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates"
import { PAYMENT_SCHEDULE_MODULE } from "../../modules/payment_schedule"
import { PARTNER_MODULE } from "../../modules/partner"
import { resolveRetailPartnerId } from "../../modules/partner_billing/resolve-retail-partner"
import { registerEmailTemplateHelpers } from "../../workflows/email/steps/fetch-email-template"
import { sendNotificationEmailWorkflow } from "../../workflows/email/workflows/send-notification-email"
import { readAmount } from "../../workflows/email/workflows/order-confirmation-email-lib"
import {
  ORDER_REFUNDED_FROM,
  ORDER_REFUNDED_HTML,
  ORDER_REFUNDED_SUBJECT,
} from "./order-refunded-template"
import {
  ORDER_REFUNDED_TEMPLATE,
  buildRefundEmailVars,
  orderRefunds,
  stampRefundEmail,
  wasRefundEmailed,
  type RefundEmailVars,
} from "./order-refund-email-vars"

/**
 * Email a buyer that we refunded them (#2645 "Refund email").
 *
 * Before this NOTHING told a buyer about a refund: the money simply appeared
 * (or did not) days later. Two callers:
 *
 *  - automatic: the `payment.refunded` subscriber sends the generic version,
 *    once per refund id (`sendRefundEmailForPayment`);
 *  - manual: `POST /admin/orders/:id/refund-email` / MCP
 *    `send_order_refund_email`, with an optional admin note explaining why.
 *
 * Every send stamps the refund id on `order.metadata.refund_emails_sent`, so a
 * redelivered event never mails the same refund twice. Never throws on a send
 * failure: the refund has already happened; the outcome says whether the buyer
 * was actually told.
 */

export type RefundEmailResult = {
  sent: boolean
  preview: boolean
  to: string | null
  refund_id: string | null
  /** Why it was not sent, in plain words. Null on success / preview. */
  reason: string | null
  vars: RefundEmailVars | null
  /** Rendered, for a preview. */
  subject?: string
  html?: string
  from?: string
  /** "live" = the DB row; "repo" = no live row yet, rendered from the code copy. */
  template_source?: "live" | "repo"
}

const ORDER_FIELDS = [
  "id",
  "display_id",
  "email",
  "currency_code",
  "sales_channel_id",
  "metadata",
  "customer.first_name",
  "shipping_address.first_name",
  "billing_address.first_name",
  "payment_collections.id",
  "payment_collections.captured_amount",
  "payment_collections.refunded_amount",
  "payment_collections.payments.id",
  "payment_collections.payments.provider_id",
  "payment_collections.payments.data",
  "payment_collections.payments.captures.id",
  "payment_collections.payments.captures.amount",
  "payment_collections.payments.refunds.id",
  "payment_collections.payments.refunds.amount",
  "payment_collections.payments.refunds.created_at",
]

const readOrder = async (container: any, orderId: string) => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    fields: ORDER_FIELDS,
    filters: { id: orderId },
  })
  return data?.[0] ?? null
}

const partnerNameFor = async (container: any, salesChannelId: string | null) => {
  try {
    const partnerId = await resolveRetailPartnerId(container, salesChannelId as any)
    if (!partnerId) return ""
    const partners: any = container.resolve(PARTNER_MODULE)
    const rows = await partners.listPartners({ id: partnerId }, { select: ["id", "name"] })
    return String(rows?.[0]?.name ?? "")
  } catch {
    return ""
  }
}

/** The live template row, or the code copy when no live row exists yet. */
const loadTemplate = async (container: any) => {
  try {
    const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)
    const row = await svc.getTemplateByKey(ORDER_REFUNDED_TEMPLATE)
    return {
      subject: String(row.subject ?? ""),
      html: String(row.html_content ?? ""),
      from: row.from ?? ORDER_REFUNDED_FROM,
      source: "live" as const,
    }
  } catch (e: any) {
    if (e instanceof MedusaError && e.type === MedusaError.Types.NOT_FOUND) {
      return {
        subject: ORDER_REFUNDED_SUBJECT,
        html: ORDER_REFUNDED_HTML,
        from: ORDER_REFUNDED_FROM,
        source: "repo" as const,
      }
    }
    throw e
  }
}

export const renderRefundEmail = (
  template: { subject: string; html: string },
  vars: RefundEmailVars
) => {
  registerEmailTemplateHelpers()
  return {
    subject: Handlebars.compile(template.subject)(vars),
    html: Handlebars.compile(template.html)(vars),
  }
}

const stamp = async (
  container: any,
  order: any,
  refundId: string,
  source: "auto" | "manual"
) => {
  const orders: any = container.resolve(Modules.ORDER)
  // Re-read so a stamp written between our read and now is kept.
  const fresh = (await readOrder(container, order.id)) ?? order
  const metadata = stampRefundEmail(fresh.metadata, {
    refund_id: refundId,
    sent_at: new Date().toISOString(),
    source,
  })
  await orders.updateOrders([{ id: order.id, metadata }])
}

export async function sendOrderRefundEmail(
  container: any,
  input: {
    order_id: string
    /** Major units. Defaults to the order's latest refund. */
    amount?: number | null
    /** The refund this email is about, when known (stamped for idempotency). */
    refund_id?: string | null
    note?: string | null
    preview?: boolean
    source?: "auto" | "manual"
  }
): Promise<RefundEmailResult> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const source = input.source ?? "manual"
  const order = await readOrder(container, input.order_id)
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order ${input.order_id} not found`)
  }

  const latest = orderRefunds(order)[0] ?? null
  const explicit =
    input.amount !== undefined && input.amount !== null && Number.isFinite(Number(input.amount))
  const amount = explicit ? Number(input.amount) : latest?.amount ?? null
  if (amount === null || !(amount > 0)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Order ${input.order_id} has no refund recorded. Pass the refunded amount explicitly.`
    )
  }
  // The refund this email is about: given, or the latest one when the amount
  // is the latest refund's.
  const refundId =
    input.refund_id ??
    (latest && (!explicit || Math.abs(latest.amount - amount) < 0.005) ? latest.id : null)

  const schedules: any = container.resolve(PAYMENT_SCHEDULE_MODULE)
  const schedule = await schedules.findByOrderId(order.id).catch(() => null)
  const vars = buildRefundEmailVars({
    order,
    schedule,
    refund_amount: amount,
    note: input.note ?? null,
    partner_name: await partnerNameFor(container, order.sales_channel_id ?? null),
  })
  const to = String(order.email ?? "").trim() || null

  if (input.preview) {
    const template = await loadTemplate(container)
    const rendered = renderRefundEmail(template, vars)
    return {
      sent: false,
      preview: true,
      to,
      refund_id: refundId,
      reason: to ? null : "There is no buyer email on this order; a send would fail.",
      vars,
      subject: rendered.subject,
      html: rendered.html,
      from: template.from,
      template_source: template.source,
    }
  }

  if (!to) {
    return {
      sent: false,
      preview: false,
      to: null,
      refund_id: refundId,
      reason: "Not sent: there is no buyer email on this order. Tell the buyer yourself.",
      vars,
    }
  }

  try {
    const { result } = await sendNotificationEmailWorkflow(container).run({
      input: {
        to,
        template: ORDER_REFUNDED_TEMPLATE,
        data: vars as unknown as Record<string, any>,
      },
    })
    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      return {
        sent: false,
        preview: false,
        to,
        refund_id: refundId,
        reason: "Not sent: the address is a known crawler address and mail to it is suppressed.",
        vars,
      }
    }
  } catch (e: any) {
    const reason = `Not sent: ${e?.message ?? String(e)}`
    logger.error?.(`[refund-email] order ${order.id} to ${to} failed: ${reason}`)
    return { sent: false, preview: false, to, refund_id: refundId, reason, vars }
  }

  if (refundId) {
    try {
      await stamp(container, order, refundId, source)
    } catch (e: any) {
      logger.warn?.(
        `[refund-email] order ${order.id}: sent, but stamping refund ${refundId} failed (a redelivered event could resend): ${e?.message ?? e}`
      )
    }
  }
  logger.info?.(`[refund-email] ${source} refund email for order ${order.id} (${vars.refund_amount}) sent to ${to}`)
  return { sent: true, preview: false, to, refund_id: refundId, reason: null, vars }
}

/**
 * The automatic path: a `payment.refunded` event carries only the payment id.
 * Emails the NEWEST refund on that payment, once. Only the newest: an older
 * refund that was never emailed (made before this existed) must not be mailed
 * on a later refund's event.
 */
export async function sendRefundEmailForPayment(
  container: any,
  paymentId: string
): Promise<RefundEmailResult | { sent: false; reason: string }> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "payment",
    fields: [
      "id",
      "refunds.id",
      "refunds.amount",
      "refunds.created_at",
      "payment_collection.order.id",
    ],
    filters: { id: paymentId },
  })
  const payment = data?.[0]
  const orderId = payment?.payment_collection?.order?.id
  if (!orderId) return { sent: false, reason: "payment is not on an order" }

  const newest = [...(payment.refunds ?? [])].sort((a: any, b: any) =>
    String(new Date(b.created_at ?? 0).toISOString()).localeCompare(
      String(new Date(a.created_at ?? 0).toISOString())
    )
  )[0]
  if (!newest?.id) return { sent: false, reason: "payment has no refund" }

  const order = await readOrder(container, orderId)
  if (wasRefundEmailed(order?.metadata, newest.id)) {
    return { sent: false, reason: `refund ${newest.id} was already emailed` }
  }

  return sendOrderRefundEmail(container, {
    order_id: orderId,
    amount: readAmount(newest.amount),
    refund_id: newest.id,
    source: "auto",
  })
}
