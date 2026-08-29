/**
 * How a goods transfer's carrier reads on screen (#1553).
 *
 * PURE, and shared for the same reason `describePaymentLine` is: the admin run
 * page and the partner run page both show these hops, and the moment each
 * decides for itself what "no carrier" looks like, the two disagree about
 * whether a waybill exists.
 */

export type TransferCarrierLine = {
  /** The sentence, already assembled. */
  text: string
  /** True for an absence or a loss — something to state quietly, not a fact. */
  muted: boolean
  /** The AWB, when there is one, so the caller can render it as a link. */
  awb: string | null
  trackingUrl: string | null
  labelUrl: string | null
}

const prettyStatus = (status: string | null | undefined): string | null =>
  status ? String(status).replace(/_/g, " ") : null

const prettyDate = (value: string | null | undefined): string | null => {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString()
}

/**
 * What to say about the carrier on one transfer row.
 *
 * 🔴 The three `carrier_state` values stay three. `not_booked` and
 * `unresolved` both have no facts to show, and rendering them the same way
 * tells an operator *nobody booked this* when the truth is *a waybill exists
 * and the server could not read it* — which is how someone re-books goods the
 * carrier already collected.
 */
export const describeTransferCarrier = (transfer: any): TransferCarrierLine => {
  const state = transfer?.carrier_state

  if (state === "unresolved") {
    return {
      text: `Carrier booked — shipment ${transfer?.shipment_id ?? ""} could not be read`.trim(),
      muted: true,
      awb: null,
      trackingUrl: null,
      labelUrl: null,
    }
  }

  const shipment = transfer?.shipment
  if (state !== "booked" || !shipment) {
    return {
      text: "No carrier booked",
      muted: true,
      awb: null,
      trackingUrl: null,
      labelUrl: null,
    }
  }

  /**
   * Assembled from whatever actually arrived. A booking that failed part-way
   * leaves a row with null fields, and printing "null · AWB null" would be
   * worse than the toast this replaces.
   */
  const parts = [
    shipment.carrier || "Carrier",
    shipment.awb ? `AWB ${shipment.awb}` : null,
    prettyStatus(shipment.status),
    shipment.pickup_scheduled_date
      ? `pickup ${prettyDate(shipment.pickup_scheduled_date) || shipment.pickup_scheduled_date}`
      : null,
  ].filter(Boolean)

  return {
    text: parts.join(" · "),
    muted: false,
    awb: shipment.awb ?? null,
    trackingUrl: shipment.tracking_url ?? null,
    labelUrl: shipment.label_url ?? null,
  }
}

/** "shipped 29 Aug · received 31 Aug", or null when neither has happened. */
export const describeTransferMovement = (transfer: any): string | null => {
  const parts = [
    transfer?.shipped_at ? `shipped ${prettyDate(transfer.shipped_at)}` : null,
    transfer?.received_at ? `received ${prettyDate(transfer.received_at)}` : null,
  ].filter(Boolean)

  return parts.length ? parts.join(" · ") : null
}
