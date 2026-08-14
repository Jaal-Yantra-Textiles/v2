import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createOrderShipmentWorkflow } from "@medusajs/medusa/core-flows"
import { buildAttachAwbLabels } from "./shiprocket-attach-awb"

/**
 * Attach (and detach) a waybill we did NOT book — the manual override.
 *
 * Every other path in this system assumes we created the shipment: the label
 * routes call a carrier API, `attachExistingShiprocketAwb` validates the AWB by
 * looking it up on Shiprocket, and `cancelShipmentForFulfillment` voids it at
 * the carrier. All of that breaks the moment a parcel is booked outside those
 * integrations, which happens more often than the code assumed:
 *
 *  - a carrier we do not integrate at all (DTDC, India Post, a local courier);
 *  - a waybill generated on a carrier's own portal because ours was down — the
 *    exact situation order 83 sat in while Blue Dart returned an empty 400;
 *  - a counter booking, or a partner who shipped on their own account.
 *
 * Two things make this different from `attachExistingShiprocketAwb`, and both
 * are deliberate:
 *
 * **No carrier call. At all.** Not to create, not to validate. Validation by
 * lookup is precisely what makes the existing attach unusable here: it is
 * hard-wired to Shiprocket, and even pointed at the right carrier it would
 * reject a freshly-created waybill, because Blue Dart's TnT answers a scanless
 * AWB with "Incorrect waybill number or No information" — indistinguishable
 * from a typo. An operator who is holding the physical waybill is a better
 * authority than an API that cannot see it yet.
 *
 * **It is recorded as external.** `data.external_attachment` marks the parcel as
 * something we track but do not control, so the UI can stop offering label
 * downloads and rate lookups that were never going to work.
 */

/** What an external attachment records about its provenance. */
export type ExternalAttachment = {
  /** Carrier as the operator named it — free text; may be unintegrated. */
  carrier: string
  awb: string
  attached_at: string
  attached_by?: string
  /** Why this was booked outside the system; shown in the audit trail. */
  notes?: string
}

/** Carrier ref keys an attach writes and a detach clears. */
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
 * Pure: the `fulfillment.data` an external attachment leaves behind.
 *
 * Exported for unit testing — this decides what the rest of the system will
 * believe about a parcel nobody here booked.
 */
export function planExternalAttachData(
  data: Record<string, any> | null | undefined,
  input: {
    carrier: string
    awb: string
    trackingUrl?: string
    labelUrl?: string
    attachment: ExternalAttachment
  }
): Record<string, any> {
  const history = Array.isArray(data?.external_attachments)
    ? data!.external_attachments
    : []
  return {
    ...(data || {}),
    carrier: input.carrier,
    waybill: input.awb,
    tracking_number: input.awb,
    tracking_url: input.trackingUrl || "",
    label_url: input.labelUrl || "",
    // The flag the UI keys off to stop offering what we cannot do for a parcel
    // we did not book: no label to regenerate, no rate to quote.
    external_attachment: input.attachment,
    external_attachments: [...history, input.attachment],
    provider_refs: { waybill: input.awb },
  }
}

/**
 * Pure: the `fulfillment.data` a detach leaves behind.
 *
 * ⚠️ NULLS the refs rather than deleting them. `updateFulfillment` MERGES the
 * `data` jsonb, so a removed key is re-supplied from the stored row — the bug
 * that left order 83 advertising a cancelled Delhivery AWB. Same rule here:
 * every reader tests truthiness, so an explicit null reads as gone AND survives
 * the merge.
 *
 * The attachment history is kept. A detach means "this waybill is no longer
 * ours to show", not "this never happened" — and the AWB is the only handle for
 * reconciling a courier's invoice against the order later.
 */
export function planDetachedFulfillmentData(
  data: Record<string, any> | null | undefined,
  record: { awb?: string; carrier?: string; detached_at: string; detached_by?: string; reason?: string }
): Record<string, any> {
  const next: Record<string, any> = { ...(data || {}) }
  for (const key of CARRIER_DATA_KEYS) {
    next[key] = null
  }
  next.external_attachment = null
  const history = Array.isArray(next.detached_shipments)
    ? next.detached_shipments
    : []
  next.detached_shipments = [...history, record]
  return next
}

export type AttachExternalAwbInput = {
  orderId: string
  fulfillmentId: string
  awb: string
  /** Carrier name as the operator knows it. Not required to be integrated. */
  carrier: string
  trackingUrl?: string
  labelUrl?: string
  /**
   * Mark the fulfillment shipped. Off by default: attaching a waybill and
   * handing the parcel over are different events, and a waybill is routinely
   * generated the night before. The operator says when it actually left.
   */
  markShipped?: boolean
  notes?: string
  actingEmail?: string
}

export type AttachExternalAwbResult = {
  fulfillment_id: string
  carrier: string
  awb: string
  attached_at: string
  marked_shipped: boolean
}

export async function attachExternalAwb(
  container: MedusaContainer,
  input: AttachExternalAwbInput
): Promise<AttachExternalAwbResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const awb = String(input.awb || "").trim()
  const carrier = String(input.carrier || "").trim().toLowerCase()
  if (!awb) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "An AWB is required")
  }
  if (!carrier) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A carrier name is required — it is what tells an operator who is actually carrying the parcel."
    )
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      "items.detail.quantity",
      "fulfillments.id",
      "fulfillments.data",
      // `updateFulfillment` REPLACES the labels collection, so existing rows
      // must be carried through by id or the ORM deletes them.
      "fulfillments.labels.id",
      "fulfillments.labels.tracking_number",
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

  // Refuse to paper over a live waybill. Overwriting the refs would orphan it —
  // still billable, still moving, and no longer pointed at by anything here.
  // That is the #1225 orphan class, which is exactly what the cancel flow was
  // built to prevent; make the operator go through it.
  const existingAwb = fulfillment.data?.waybill || fulfillment.data?.tracking_number
  if (existingAwb && String(existingAwb) !== awb) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Fulfillment ${input.fulfillmentId} already carries AWB ${existingAwb}. Cancel or detach it first — attaching over a live waybill leaves it billable with nothing pointing at it.`
    )
  }

  const attachedAt = new Date().toISOString()
  const attachment: ExternalAttachment = {
    carrier,
    awb,
    attached_at: attachedAt,
    attached_by: input.actingEmail,
    notes: input.notes,
  }

  // #1195: the label row is the ONLY way a fulfillment can be found from an AWB
  // (`data` is jsonb and cannot be filtered), so it is what makes this parcel
  // discoverable to any later status push or manual lookup.
  const labels = buildAttachAwbLabels(fulfillment.labels, {
    tracking_number: awb,
    tracking_url: input.trackingUrl || "",
    label_url: input.labelUrl || "",
  })

  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: planExternalAttachData(fulfillment.data, {
      carrier,
      awb,
      trackingUrl: input.trackingUrl,
      labelUrl: input.labelUrl,
      attachment,
    }),
    labels: labels as any,
  })

  let markedShipped = false
  if (input.markShipped) {
    const items = (order.items || []).map((i: any) => ({
      id: i.id,
      quantity: Number(i.detail?.quantity ?? i.quantity) || 1,
    }))
    try {
      await createOrderShipmentWorkflow(container).run({
        input: {
          order_id: input.orderId,
          fulfillment_id: input.fulfillmentId,
          items,
          // NOT `[]` — that is a full replace and would drop the AWB label we
          // just wrote, taking the parcel's only discoverable handle with it.
          labels: labels as any,
          no_notification: true,
        },
      })
      markedShipped = true
    } catch (e: any) {
      // Best-effort: the AWB is attached either way, and reporting a failed
      // attach for one that succeeded would send an operator to re-attach it.
      logger?.warn?.(
        `[external-awb] could not mark fulfillment ${input.fulfillmentId} shipped: ${e?.message}. The AWB IS attached.`
      )
    }
  }

  logger?.info?.(
    `[external-awb] attached ${carrier} ${awb} to fulfillment ${input.fulfillmentId} (order ${input.orderId})${
      input.notes ? `: ${input.notes}` : ""
    }`
  )

  return {
    fulfillment_id: input.fulfillmentId,
    carrier,
    awb,
    attached_at: attachedAt,
    marked_shipped: markedShipped,
  }
}

export type DetachAwbInput = {
  orderId: string
  fulfillmentId: string
  reason?: string
  actingEmail?: string
}

export type DetachAwbResult = {
  fulfillment_id: string
  carrier?: string
  awb?: string
  detached_at: string
}

/**
 * Remove a waybill's refs from a fulfillment WITHOUT touching the carrier.
 *
 * The counterpart the cancel flow has been telling operators about since #1286
 * — "Cancel it directly with the carrier, then detach the AWB here" — while no
 * detach existed anywhere. It is the correct exit for a waybill we cannot void
 * through an API: an unintegrated carrier, or one booked on someone else's
 * account.
 *
 * Deliberately does NOT call `cancelShipment`. A detach says "this is no longer
 * ours to display"; whether the waybill is dead at the carrier is the operator's
 * assertion, not something this can verify. Conflating the two would let a
 * detach quietly leave a live billable waybill behind — or claim to have voided
 * one it never touched.
 */
export async function detachAwbFromFulfillment(
  container: MedusaContainer,
  input: DetachAwbInput
): Promise<DetachAwbResult> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: ["id", "fulfillments.id", "fulfillments.data"],
    filters: { id: input.orderId },
  })
  const fulfillment = (orders?.[0]?.fulfillments || []).find(
    (f: any) => f.id === input.fulfillmentId
  )
  if (!fulfillment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Fulfillment ${input.fulfillmentId} not found on order ${input.orderId}`
    )
  }

  const data = (fulfillment.data || {}) as Record<string, any>
  const awb = data.waybill || data.tracking_number
  if (!awb) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Fulfillment ${input.fulfillmentId} carries no AWB to detach.`
    )
  }

  const detachedAt = new Date().toISOString()
  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: planDetachedFulfillmentData(data, {
      awb: String(awb),
      carrier: data.carrier,
      detached_at: detachedAt,
      detached_by: input.actingEmail,
      reason: input.reason,
    }),
    // Drop the label row with it: it is the key the tracking webhook matches
    // pushes on, and leaving it would let a scan for a waybill we no longer
    // claim land back on this order.
    labels: [],
  })

  logger?.info?.(
    `[external-awb] detached ${data.carrier || "unknown"} ${awb} from fulfillment ${input.fulfillmentId}${
      input.reason ? `: ${input.reason}` : ""
    }`
  )

  return {
    fulfillment_id: input.fulfillmentId,
    carrier: data.carrier,
    awb: String(awb),
    detached_at: detachedAt,
  }
}
