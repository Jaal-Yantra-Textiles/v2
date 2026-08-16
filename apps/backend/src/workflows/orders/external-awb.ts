import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { createOrderShipmentWorkflow } from "@medusajs/medusa/core-flows"
import { buildAttachAwbLabels } from "./shiprocket-attach-awb"
import { resolveShippingFx } from "./shipping-fx"
import { PARTNER_BILLING_MODULE } from "../../modules/partner_billing"
import type { ShippingFxRecord } from "../../modules/partner_billing/shipping-ledger"

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

/**
 * Public tracking-page URL patterns for carriers we do NOT integrate.
 *
 * An integrated carrier builds its own link in its adapter (see bluedart's
 * `adapter.ts`). This path has no adapter by definition — the whole point is a
 * waybill from a carrier we cannot call — so the link has to come from
 * somewhere, and "the operator remembers to paste one" is not somewhere. Order
 * 79 shipped with an empty `tracking_url` for exactly that reason, leaving a
 * tracking mail with a bare number and nothing to click.
 *
 * Keys are the lowercased carrier name as the operator types it.
 */
export const EXTERNAL_CARRIER_TRACKING_URLS: Record<string, string> = {
  dtdc: "https://www.dtdc.com/track-your-shipment/?awb={awb}",
}

/**
 * The tracking link to stamp on this attachment.
 *
 * An operator-supplied URL always wins — they are holding the waybill and may
 * have a better link than any pattern. Otherwise fall back to a known public
 * pattern, and to "" when the carrier has none, which is what every reader
 * already treats as absent.
 */
export function resolveExternalTrackingUrl(
  carrier: string,
  awb: string,
  explicit?: string
): string {
  const supplied = (explicit || "").trim()
  if (supplied) return supplied
  if (!awb) return ""
  const template = EXTERNAL_CARRIER_TRACKING_URLS[carrier.trim().toLowerCase()]
  return template
    ? template.replace("{awb}", encodeURIComponent(awb))
    : ""
}

/**
 * Should marking this externally-booked parcel shipped tell the customer?
 *
 * **Yes, unless the operator says otherwise.** Same as every other shipment —
 * which is the whole point, because this path was the only one that silently
 * differed.
 *
 * An earlier draft defaulted to "only when a waybill on this fulfillment was
 * cancelled first", reasoning that a first attach promised nothing and that one
 * parcel should not yield two shipped mails. Prod falsified that. **Order 79**
 * (`rpivko@gmail.com`, DTDC `N40878729`) is an external attach marked shipped on
 * 2026-08-08 with **no** `cancelled_shipments` record — its abandoned Shiprocket
 * booking was never cancelled through `cancel-shipment`, so nothing was written
 * here. Under that rule the customer would stay silent forever, and in fact has:
 * the parcel shipped and nobody ever sent them a tracking number.
 *
 * The double-mail worry was unfounded. Marking shipped emits exactly ONE shipped
 * mail on the ordinary path; on this path it emitted zero, because
 * `no_notification` was hardcoded true. So the old default did not prevent a
 * second mail — it suppressed the only one.
 *
 * A cancelled predecessor makes it more urgent (`cancel-shipment` explicitly
 * promised a fresh link) but it was never the thing that made it correct.
 *
 * Pure so the decision is testable without a container — the surrounding attach
 * needs a live fulfillment module, which is exactly how this stayed an
 * un-inspectable hardcoded `true` long enough to strand two orders.
 */
export function resolveExternalAwbNotify(
  _fulfillmentData: Record<string, any> | null | undefined,
  explicit?: boolean
): boolean {
  return typeof explicit === "boolean" ? explicit : true
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
  /**
   * Email the customer the tracking details when this is marked shipped.
   *
   * **Defaults to TRUE** — the same as every other shipment. This path was the
   * only one that silently differed: it hardcoded `no_notification: true`, so a
   * parcel booked at a counter went out and nobody ever told the customer.
   * Order 79's DTDC waybill shipped on 2026-08-08 and its customer has still
   * never been sent a tracking number.
   *
   * Set false for a back-fill or a correction, where the customer already has
   * the details and a second mail would only confuse.
   *
   * Only meaningful with `markShipped`: without a shipment there is nothing to
   * send, since the mail is built from the shipment's labels. That also matches
   * what `cancel-shipment` promises — the fresh link comes when the new courier
   * has collected the parcel, not when its waybill was printed.
   */
  notifyCustomer?: boolean
  notes?: string
  actingEmail?: string
  /**
   * What this waybill cost, when the operator knows it.
   *
   * Unique to this path: every integrated carrier returns a rate with the label
   * (`provider_refs.courier_rate`), so freight records itself. A counter booking
   * has a receipt and no API, and until #1305 there was nowhere to put it — the
   * order kept whatever the ABANDONED booking had cost, which is how order 79
   * came to carry a ₹6,944 Shiprocket charge for a parcel that went DTDC.
   *
   * Omitted leaves the ledger untouched. Attaching a waybill and knowing its
   * price are separate facts, and a blank field must not read as "free".
   */
  shippingAmount?: number | null
  /** Currency of `shippingAmount`. Defaults to the order's when omitted. */
  shippingCurrencyCode?: string | null
  /**
   * The FX rate actually paid, when it differs from the market rate. Only used
   * if the charge currency differs from the order's. See `resolveShippingFx`.
   */
  shippingFxRate?: number | null
}

export type AttachExternalAwbResult = {
  fulfillment_id: string
  carrier: string
  awb: string
  attached_at: string
  marked_shipped: boolean
  /**
   * Whether the customer was sent the new tracking details.
   *
   * Returned rather than assumed: the mail is best-effort (a missing template
   * must not fail an attach that succeeded), and "did the customer get told"
   * is the question an operator asks straight after a courier change.
   */
  customer_notified: boolean
  /**
   * What was written to the freight ledger, or null when no cost was supplied
   * or there was no partner fee row to hang it off. Returned rather than
   * swallowed so an operator can see the CONVERTED figure that will actually
   * come off the payout — which is the number they will be asked about, and is
   * not the one they typed.
   */
  shipping_charge: {
    amount: number
    currency_code: string
    fx: ShippingFxRecord | null
  } | null
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
  const trackingUrl = resolveExternalTrackingUrl(carrier, awb, input.trackingUrl)

  const labels = buildAttachAwbLabels(fulfillment.labels, {
    tracking_number: awb,
    tracking_url: trackingUrl,
    label_url: input.labelUrl || "",
  })

  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: planExternalAttachData(fulfillment.data, {
      carrier,
      awb,
      trackingUrl,
      labelUrl: input.labelUrl,
      attachment,
    }),
    labels: labels as any,
  })

  const notifyCustomer = resolveExternalAwbNotify(
    fulfillment.data,
    input.notifyCustomer
  )

  let markedShipped = false
  let customerNotified = false
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
          // Reuses the ordinary shipped mail rather than a bespoke one: it is
          // already built from the fulfillment's labels, which now hold THIS
          // waybill, so the customer gets real tracking for the carrier the
          // parcel is actually on. A template invented for this path would be a
          // second thing to seed and a second thing to be missing on prod.
          no_notification: !notifyCustomer,
        },
      })
      markedShipped = true
      customerNotified = notifyCustomer
    } catch (e: any) {
      // Best-effort: the AWB is attached either way, and reporting a failed
      // attach for one that succeeded would send an operator to re-attach it.
      logger?.warn?.(
        `[external-awb] could not mark fulfillment ${input.fulfillmentId} shipped: ${e?.message}. The AWB IS attached.`
      )
    }
  }

  const shippingCharge = await recordExternalFreight(container, {
    orderId: input.orderId,
    fulfillmentId: input.fulfillmentId,
    carrier,
    awb,
    amount: input.shippingAmount,
    currencyCode: input.shippingCurrencyCode,
    operatorRate: input.shippingFxRate,
    recordedAt: attachedAt,
  })

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
    customer_notified: customerNotified,
    shipping_charge: shippingCharge,
  }
}

/**
 * Write an externally-booked parcel's freight onto the partner fee ledger.
 *
 * Best-effort by design, mirroring the integrated carriers' own recording step:
 * the waybill IS attached by the time this runs, and failing the whole attach
 * because a billing row could not be updated would send an operator back to
 * re-attach a parcel that is already correct.
 *
 * Returns what was recorded — CONVERTED, if the carrier billed in a currency
 * other than the order's — or null when there was no cost to record or no fee
 * row to record it against.
 */
async function recordExternalFreight(
  container: MedusaContainer,
  args: {
    orderId: string
    fulfillmentId: string
    carrier: string
    awb: string
    amount?: number | null
    currencyCode?: string | null
    operatorRate?: number | null
    recordedAt: string
  }
): Promise<AttachExternalAwbResult["shipping_charge"]> {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const amount = Number(args.amount)
  // Absent means "cost unknown", which is not the same as free. A recorded 0 IS
  // a real charge and passes here, matching the rule the ledger already applies.
  if (args.amount === null || args.amount === undefined || !Number.isFinite(amount)) {
    return null
  }

  try {
    const billing: any = container.resolve(PARTNER_BILLING_MODULE)
    const fee = await billing.findFeeForOrder(args.orderId)
    if (!fee) {
      // Retail order with no partner, or accrual hasn't run. Nothing to hang the
      // cost off, and inventing a fee row is not this path's business.
      logger?.info?.(
        `[external-awb] no partner fee row for order ${args.orderId}; freight of ${amount} not recorded.`
      )
      return null
    }

    const orderCurrency = String(fee.currency_code || "").toUpperCase()
    const charged = String(args.currencyCode || orderCurrency).toUpperCase()

    const converted = await resolveShippingFx(container, {
      amount,
      currency_code: charged,
      orderCurrency,
      operatorRate: args.operatorRate,
      now: args.recordedAt,
    })

    await billing.recordShippingChargeForOrder(args.orderId, {
      fulfillment_id: args.fulfillmentId,
      amount: converted ? converted.amount : amount,
      currency_code: converted ? converted.currency_code : charged,
      carrier: args.carrier,
      awb: args.awb,
      recorded_at: args.recordedAt,
      fx: converted?.fx ?? null,
    })

    logger?.info?.(
      `[external-awb] recorded freight for order ${args.orderId}: ${amount} ${charged}` +
        (converted
          ? ` -> ${converted.amount} ${converted.currency_code} @ ${converted.fx.fx_rate} (${converted.fx.fx_source})`
          : "")
    )

    return {
      amount: converted ? converted.amount : amount,
      currency_code: converted ? converted.currency_code : charged,
      fx: converted?.fx ?? null,
    }
  } catch (e: any) {
    logger?.warn?.(
      `[external-awb] could not record freight for order ${args.orderId}: ${e?.message}. The AWB IS attached.`
    )
    return null
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
