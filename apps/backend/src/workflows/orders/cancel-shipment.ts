import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import type { INotificationModuleService } from "@medusajs/types"
import * as Handlebars from "handlebars"
import {
  isSupportedCarrier,
  resolveShippingProvider,
  shipmentRefFromFulfillment,
} from "../../modules/shipping-providers/resolver"
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates"

/**
 * Cancel a carrier waybill for a fulfillment, end to end.
 *
 * Every carrier client has implemented `cancelShipment` since the #31 provider
 * spike, and until now NOTHING reached it — no route, no workflow, no UI. The
 * only callers were a dev script and #1233's internal "a failed AWB assign must
 * cancel the order it just created". So an operator whose parcel hit a problem
 * (a pickup that never happens, a partner change, a wrong address caught late)
 * had a live waybill they could only kill on the carrier's own dashboard, while
 * our fulfillment went on claiming it.
 *
 * The ordering here is the whole design:
 *
 *   1. cancel at the CARRIER first,
 *   2. only then clear the refs from `fulfillment.data`.
 *
 * Never the reverse. Clearing first and failing at the carrier would leave a
 * live, billable waybill that nothing in our system points at any more — which
 * is precisely the orphan class #1225 was filed for. If the carrier refuses,
 * this throws and the fulfillment is left exactly as it was.
 */

/** What a cancellation records about the shipment it retired. */
export type CancelledShipmentRecord = {
  carrier?: string
  awb?: string
  /** ISO timestamp of the cancellation. */
  cancelled_at: string
  /** Admin email that performed it, when known. */
  cancelled_by?: string
  reason?: string
  /** Carrier-side ids, kept so the cancellation can be reconciled later. */
  provider_refs?: Record<string, any>
}

/** The carrier keys `createShiprocketShipmentForFulfillment` writes and this clears. */
const CARRIER_DATA_KEYS = [
  "carrier",
  "waybill",
  "tracking_number",
  "tracking_url",
  "label_url",
  "shipment_id",
  "sr_order_id",
  "provider_refs",
] as const

/**
 * Pure: the `fulfillment.data` a cancelled shipment leaves behind.
 *
 * Strips every carrier ref so the fulfillment reads as un-labelled and the
 * existing "generate label" path can run again against a different carrier —
 * and appends an audit entry, because the AWB we just voided is the only handle
 * anyone has for reconciling a carrier invoice against it later. Losing that on
 * the way out would make the cancellation itself untraceable.
 *
 * Exported for unit testing: this is the half that decides what survives.
 */
export function planCancelledFulfillmentData(
  data: Record<string, any> | null | undefined,
  record: CancelledShipmentRecord
): Record<string, any> {
  const next: Record<string, any> = { ...(data || {}) }
  for (const key of CARRIER_DATA_KEYS) {
    delete next[key]
  }
  const history = Array.isArray(next.cancelled_shipments)
    ? next.cancelled_shipments
    : []
  next.cancelled_shipments = [...history, record]
  return next
}

export type CancelShipmentInput = {
  orderId: string
  fulfillmentId: string
  /** Free-text operator reason; surfaced in the audit entry and the email. */
  reason?: string
  /** Acting admin's email, recorded on the audit entry. */
  actingEmail?: string
  /**
   * Cancel even though the fulfillment is already marked shipped. Off by
   * default: a shipped parcel is physically in the carrier's network, and
   * voiding its waybill strands a box nobody can route.
   */
  force?: boolean
  /**
   * Email the customer that we hit a problem and are moving them to another
   * courier. Defaults to true — the customer is the one person guaranteed to
   * notice the tracking link going dead.
   */
  notifyCustomer?: boolean
}

export type CancelShipmentResult = {
  fulfillment_id: string
  carrier?: string
  awb?: string
  cancelled_at: string
  /** True when a customer email actually went out. */
  customer_notified: boolean
  raw?: any
}

export async function cancelShipmentForFulfillment(
  container: MedusaContainer,
  input: CancelShipmentInput
): Promise<CancelShipmentResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "shipping_address.first_name",
      "shipping_address.last_name",
      "customer.first_name",
      "customer.last_name",
      "customer.email",
      "fulfillments.id",
      "fulfillments.data",
      "fulfillments.shipped_at",
      "fulfillments.canceled_at",
    ],
    filters: { id: input.orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${input.orderId} not found`
    )
  }
  const fulfillment = (order.fulfillments || []).find(
    (f: any) => f.id === input.fulfillmentId
  )
  if (!fulfillment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Fulfillment ${input.fulfillmentId} not found on order ${input.orderId}`
    )
  }

  const data = (fulfillment.data || {}) as Record<string, any>
  const ref = shipmentRefFromFulfillment(data)
  const carrier = data.carrier as string | undefined
  const awb = ref.awb

  if (!awb && !ref.provider_refs?.sr_order_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Fulfillment ${input.fulfillmentId} carries no carrier shipment to cancel.`
    )
  }
  if (!isSupportedCarrier(carrier)) {
    // An AWB attached by hand (#1267's attach flow) or a manual fulfillment has
    // no carrier API behind it. Say so rather than throwing a resolver error
    // the operator can do nothing about.
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Fulfillment ${input.fulfillmentId} has no cancellable carrier${
        carrier ? ` (carrier "${carrier}")` : ""
      }. Cancel it directly with the carrier, then detach the AWB here.`
    )
  }
  if (fulfillment.shipped_at && !input.force) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Fulfillment ${input.fulfillmentId} is already marked shipped — the parcel is in ${carrier}'s network. Cancelling its waybill strands the box. Re-send with force if the handover never actually happened.`
    )
  }

  const provider = await resolveShippingProvider(container, carrier)
  if (!provider.cancelShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `${carrier} provider does not support cancelling a shipment`
    )
  }

  // Carrier FIRST. A throw here leaves the fulfillment untouched, which is the
  // correct end state: the waybill is still live and still ours.
  const outcome = await provider.cancelShipment(ref)
  if (!outcome?.success) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `${carrier} refused to cancel ${awb || "the shipment"}. The waybill is still live; nothing was changed here.`
    )
  }

  const cancelledAt = new Date().toISOString()
  const record: CancelledShipmentRecord = {
    carrier,
    awb,
    cancelled_at: cancelledAt,
    cancelled_by: input.actingEmail,
    reason: input.reason,
    provider_refs: ref.provider_refs,
  }

  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: planCancelledFulfillmentData(data, record),
    // Drop the label row too. It isn't cosmetic: the AWB is stamped as a
    // `fulfillment_label` tracking number precisely because that is the
    // queryable key the tracking webhook matches carrier pushes on (`data` is
    // JSONB and can't be filtered). Leaving a dead label behind lets a late
    // scan for a voided waybill land back on this order.
    labels: [],
  })

  logger.info(
    `[cancel-shipment] cancelled ${carrier} ${awb} on fulfillment ${input.fulfillmentId} (order ${input.orderId})${
      input.reason ? `: ${input.reason}` : ""
    }`
  )

  const customerNotified =
    input.notifyCustomer === false
      ? false
      : await notifyCustomerOfCarrierChange(container, {
          order,
          carrier,
          reason: input.reason,
        })

  return {
    fulfillment_id: input.fulfillmentId,
    carrier,
    awb,
    cancelled_at: cancelledAt,
    customer_notified: customerNotified,
    raw: outcome.raw,
  }
}

/** Template key seeded by `seed-shipment-cancelled-email.ts`. */
export const CARRIER_CHANGED_TEMPLATE_KEY = "order-courier-changed"

/**
 * Tell the customer their courier changed. Best-effort by design.
 *
 * The waybill is already cancelled at the carrier by the time this runs, and
 * that is not undoable. Failing the whole operation because a template row is
 * missing (this key is seeded separately, so it will not exist on an
 * un-seeded environment) would report "cancel failed" for a cancel that
 * definitively succeeded — the worst possible lie to tell an operator who now
 * has to decide whether to retry.
 */
async function notifyCustomerOfCarrierChange(
  container: MedusaContainer,
  args: { order: any; carrier?: string; reason?: string }
): Promise<boolean> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const { order } = args
  const to = order?.email || order?.customer?.email
  if (!to) {
    logger?.warn?.(
      `[cancel-shipment] order ${order?.id} has no email — customer not notified of the courier change`
    )
    return false
  }

  try {
    const templates: any = container.resolve(EMAIL_TEMPLATES_MODULE)
    const template = await templates.getTemplateByKey(
      CARRIER_CHANGED_TEMPLATE_KEY
    )

    const name =
      [order?.shipping_address?.first_name, order?.shipping_address?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      [order?.customer?.first_name, order?.customer?.last_name]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      "there"

    const templateData = {
      customer_name: name,
      order_display_id: order?.display_id ? `#${order.display_id}` : order?.id,
      order_id: order?.id || "",
      // Deliberately NOT the operator's free-text reason: it is written for an
      // internal audit trail ("partner swap", "pickup no-show") and can name
      // partners, costs or blame. The customer gets the fact and the promise.
      previous_carrier: args.carrier || "",
      current_year: String(new Date().getFullYear()),
    }

    const html = Handlebars.compile(template.html_content)(templateData)
    const subject = Handlebars.compile(template.subject)(templateData)

    const notifications = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService
    await notifications.createNotifications({
      to,
      channel: "email",
      template: CARRIER_CHANGED_TEMPLATE_KEY,
      data: {
        ...templateData,
        _template_subject: subject,
        _template_html_content: html,
        _template_from: template.from,
        _template_processed: true,
      },
    })
    return true
  } catch (e: any) {
    logger?.warn?.(
      `[cancel-shipment] could not email the courier change to ${to} for order ${order?.id}: ${e?.message}. The waybill IS cancelled.`
    )
    return false
  }
}
