import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { INBOUND_EMAIL_MODULE } from "../../modules/inbound_emails"
import { ORDER_INVENTORY_MODULE } from "../../modules/inventory_orders"
import {
  buildUpdateSummary,
  ExtractedOrderUpdate,
  matchOrdersByNumber,
  normalizeOrderNumber,
} from "./lib/order-update-match"

/**
 * A supplier emails about an order we already have ("shipped", "out for
 * delivery", a tracking number). The "Inbound Mail Order" visual flow reads the
 * email, AI-extracts the fields, and runs this workflow by name.
 *
 * It ONLY writes a timeline row. No status change, no shipment, no stock: an
 * AI reading of an email must not move goods or money. Someone reads the row
 * and acts (a receipt is still the only thing that posts stock).
 *
 * - exactly one order whose supplier order number matches → activity row, the
 *   email linked to that order and marked processed
 * - none, or more than one → nothing written; the email stays `received` with
 *   the reason in `error_message`, for a person to look at. It never creates
 *   an order: a "shipped" mail for an order we never recorded is a question,
 *   not a purchase.
 */

export const LOG_INBOUND_ORDER_UPDATE_WORKFLOW = "log-inbound-order-update"
export const SUPPLIER_EMAIL_UPDATE_KIND = "supplier_email_update"

/** How far back an order can be and still match a supplier email. */
const MATCH_WINDOW_DAYS = 365

export type LogInboundOrderUpdateInput = {
  inbound_email_id: string
  extracted?: ExtractedOrderUpdate | null
}

export type LogInboundOrderUpdateResult =
  | { outcome: "logged"; inventory_order_id: string; activity_id: string }
  | { outcome: "already_logged"; inventory_order_id: string | null }
  | { outcome: "is_source_email"; inventory_order_id: string }
  | { outcome: "no_order_number" }
  | { outcome: "no_match"; order_number: string }
  | { outcome: "ambiguous"; order_number: string; inventory_order_ids: string[] }

const logInboundOrderUpdateStep = createStep(
  "log-inbound-order-update-step",
  async (input: LogInboundOrderUpdateInput, { container }) => {
    const emails = container.resolve(INBOUND_EMAIL_MODULE) as any
    const orders = container.resolve(ORDER_INVENTORY_MODULE) as any

    const email = await emails.retrieveInboundEmail(input.inbound_email_id).catch(() => null)
    if (!email) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inbound email ${input.inbound_email_id} not found`
      )
    }

    // A retried flow run must not log the same email twice.
    if (email.action_type === "log_inventory_order_update") {
      return new StepResponse<LogInboundOrderUpdateResult>({
        outcome: "already_logged",
        inventory_order_id: email.action_result?.inventory_order_id ?? null,
      })
    }

    const extracted: ExtractedOrderUpdate = input.extracted ?? {}
    const orderNumber = normalizeOrderNumber(extracted.order_number)

    const leaveForReview = async (reason: string) => {
      await emails.updateInboundEmails({
        id: email.id,
        extracted_data: extracted,
        error_message: reason,
      })
    }

    if (!orderNumber) {
      await leaveForReview("Order update: no order number found in the email.")
      return new StepResponse<LogInboundOrderUpdateResult>({ outcome: "no_order_number" })
    }

    const since = new Date(Date.now() - MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    const recent = await orders.listInventoryOrders(
      { created_at: { $gte: since } },
      { select: ["id", "metadata"] }
    )
    const matches = matchOrdersByNumber(recent ?? [], orderNumber)

    if (matches.length === 0) {
      await leaveForReview(`Order update: no inventory order has supplier order number ${orderNumber}.`)
      return new StepResponse<LogInboundOrderUpdateResult>({
        outcome: "no_match",
        order_number: orderNumber,
      })
    }
    if (matches.length > 1) {
      const ids = matches.map((m: any) => m.id)
      await leaveForReview(
        `Order update: ${ids.length} inventory orders have supplier order number ${orderNumber} (${ids.join(", ")}).`
      )
      return new StepResponse<LogInboundOrderUpdateResult>({
        outcome: "ambiguous",
        order_number: orderNumber,
        inventory_order_ids: ids,
      })
    }

    const order = matches[0] as any

    // The email this order was created FROM (the confirmation) is not an update.
    if (order.metadata?.inbound_email_id === email.id) {
      return new StepResponse<LogInboundOrderUpdateResult>({
        outcome: "is_source_email",
        inventory_order_id: order.id,
      })
    }

    const activity = await orders.createInventoryOrderActivities({
      inventory_order_id: order.id,
      activity_type: "system",
      kind: SUPPLIER_EMAIL_UPDATE_KIND,
      actor_type: "system",
      channel: "email",
      recipient: null,
      summary: buildUpdateSummary(extracted, email.subject ?? ""),
      payload: {
        inbound_email_id: email.id,
        from: email.from_address ?? null,
        subject: email.subject ?? null,
        order_number: orderNumber,
        update_type: extracted.update_type ?? null,
        status_text: extracted.status_text ?? null,
        tracking_number: extracted.tracking_number ?? null,
        carrier: extracted.carrier ?? null,
        tracking_url: extracted.tracking_url ?? null,
        expected_delivery_date: extracted.expected_delivery_date ?? null,
      },
      occurred_at: email.received_at ?? new Date(),
    })

    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    await link.create({
      [INBOUND_EMAIL_MODULE]: { inbound_email_id: email.id },
      [ORDER_INVENTORY_MODULE]: { inventory_orders_id: order.id },
    })

    await emails.updateInboundEmails({
      id: email.id,
      status: "processed",
      action_type: "log_inventory_order_update",
      action_result: { inventory_order_id: order.id, activity_id: activity.id },
      extracted_data: extracted,
      error_message: null,
    })

    return new StepResponse<LogInboundOrderUpdateResult>({
      outcome: "logged",
      inventory_order_id: order.id,
      activity_id: activity.id,
    })
  }
)

// The id is written as a literal (it equals LOG_INBOUND_ORDER_UPDATE_WORKFLOW):
// build-workflow-schemas only finds `createWorkflow("…")`, and without an entry
// in workflow-schemas.json the visual-flow editor cannot list this workflow.
export const logInboundOrderUpdateWorkflow = createWorkflow(
  "log-inbound-order-update",
  (input: LogInboundOrderUpdateInput) => {
    const result = logInboundOrderUpdateStep(input)
    return new WorkflowResponse(result)
  }
)

export default logInboundOrderUpdateWorkflow
