import {
  planCancelledFulfillmentData,
  type CancelledShipmentRecord,
} from "../cancel-shipment"

/**
 * The half of a waybill cancellation that decides what survives on
 * `fulfillment.data`. Everything else in the flow is a carrier call; this is
 * the state machine, so it is where the rules get pinned.
 */

const RECORD: CancelledShipmentRecord = {
  carrier: "delhivery",
  awb: "21089967146",
  cancelled_at: "2026-08-13T04:00:00.000Z",
  cancelled_by: "ops@jaalyantra.com",
  reason: "pickup never happened, moving to Blue Dart",
}

describe("planCancelledFulfillmentData", () => {
  it("NULLS every carrier ref — deleting them does not survive the jsonb merge", () => {
    const next = planCancelledFulfillmentData(
      {
        carrier: "delhivery",
        waybill: "21089967146",
        tracking_number: "21089967146",
        tracking_url: "https://track/21089967146",
        label_url: "https://label.pdf",
        shipment_id: "ship_1",
        sr_order_id: "sr_1",
        provider_refs: { waybill: "21089967146" },
      },
      RECORD
    )

    // This assertion used to be `not.toHaveProperty` and passed for months while
    // the refs sat untouched on prod: `updateFulfillment` MERGES `data`, so a key
    // this function removes is re-supplied from the stored row. Order 83's
    // cancellation (Delhivery AWB 41712510000092) is the proof — audit entry
    // written, labels dropped, `waybill` still there. The key must be PRESENT and
    // null, which is what actually overwrites the stored value.
    for (const key of [
      "carrier",
      "waybill",
      "tracking_number",
      "tracking_url",
      "label_url",
      "shipment_id",
      "sr_order_id",
      "provider_refs",
    ]) {
      expect(next).toHaveProperty(key)
      expect(next[key]).toBeNull()
    }
  })

  it("leaves the refs falsy, which is what every reader actually tests", () => {
    const next = planCancelledFulfillmentData(
      { carrier: "bluedart", waybill: "AWB1", provider_refs: { waybill: "AWB1" } },
      RECORD
    )
    // `shipmentRefFromFulfillment`, the label widget and the re-label path all
    // key off truthiness, so a null reads identically to an absent key to them —
    // that equivalence is the whole reason nulling is safe.
    expect(next.waybill).toBeFalsy()
    expect(next.carrier).toBeFalsy()
    expect(next.provider_refs).toBeFalsy()
  })

  it("keeps unrelated fulfillment data untouched", () => {
    const next = planCancelledFulfillmentData(
      { carrier: "shiprocket", waybill: "AWB1", pickup_location_name: "DHM-Main" },
      RECORD
    )
    expect(next.pickup_location_name).toBe("DHM-Main")
  })

  it("records the voided AWB, because it is the only handle for reconciling a carrier invoice later", () => {
    const next = planCancelledFulfillmentData({ waybill: "AWB1" }, RECORD)
    expect(next.cancelled_shipments).toEqual([RECORD])
  })

  it("appends rather than overwrites, so a second cancellation keeps the first", () => {
    const first: CancelledShipmentRecord = { ...RECORD, awb: "FIRST" }
    const afterOne = planCancelledFulfillmentData({ waybill: "FIRST" }, first)

    const second: CancelledShipmentRecord = { ...RECORD, awb: "SECOND" }
    const afterTwo = planCancelledFulfillmentData(
      { ...afterOne, waybill: "SECOND", carrier: "bluedart" },
      second
    )

    expect(afterTwo.cancelled_shipments).toEqual([first, second])
  })

  it("survives a fulfillment that has no data at all", () => {
    // The nulls are written unconditionally: a row that never had the key is
    // unaffected by being sent an explicit null for it.
    const expected = {
      carrier: null,
      waybill: null,
      tracking_number: null,
      tracking_url: null,
      label_url: null,
      shipment_id: null,
      sr_order_id: null,
      provider_refs: null,
      // The dead waybill's telemetry is nulled here too, and ONLY because
      // `captureTrackingHistory` lifts it into the cancellation record first.
      // If this list and that capture ever drift apart, the scans are deleted
      // and the reason a shipment failed goes with them.
      last_webhook: null,
      tracking_events: null,
      cancelled_shipments: [RECORD],
    }
    expect(planCancelledFulfillmentData(null, RECORD)).toEqual(expected)
    expect(planCancelledFulfillmentData(undefined, RECORD)).toEqual(expected)
  })

  it("does not mutate the fulfillment data it was handed", () => {
    const original = { carrier: "delhivery", waybill: "AWB1" }
    planCancelledFulfillmentData(original, RECORD)
    expect(original).toEqual({ carrier: "delhivery", waybill: "AWB1" })
  })

  it("tolerates a non-array cancelled_shipments rather than throwing on it", () => {
    // Hand-edited JSONB is a real possibility; a bad shape must not take out a
    // cancellation the carrier has ALREADY accepted.
    const next = planCancelledFulfillmentData(
      { waybill: "AWB1", cancelled_shipments: "corrupted" as any },
      RECORD
    )
    expect(next.cancelled_shipments).toEqual([RECORD])
  })
})

/**
 * 🔴 The dead waybill's story, kept with the waybill.
 *
 * Cancelling nulls the carrier refs, but the scan history lived in two OTHER
 * keys — `last_webhook` and `tracking_events` — which the cancellation did not
 * touch. So a cancelled fulfillment went on showing the dead parcel's journey,
 * and the obvious tidy-up (clearing those two keys) deleted the only evidence
 * of why the shipment failed.
 *
 * Order #3 is the case that forced this. AWB 8327967800746 was scanned
 * "Out for Pickup" and then "Not Picked - Shipment not received from client"
 * after ONE attempt — the whole story of the failure. Clearing the residue by
 * hand threw it away, leaving an audit entry that recorded a cancelled waybill
 * but not that a driver had come and gone empty-handed.
 *
 * So the history is lifted INTO the cancellation record before the keys are
 * nulled. Read it out, then clear it — never the reverse.
 */
describe("captureTrackingHistory", () => {
  const { captureTrackingHistory } = require("../cancel-shipment")

  const events = [
    { status: "OUT FOR PICKUP", received_at: "2026-09-11T04:58:53.685Z" },
    { status: "PICKUP EXCEPTION", received_at: "2026-09-15T14:24:07.210Z" },
  ]

  it("🔴 keeps the scans and the carrier's final word", () => {
    const h = captureTrackingHistory({
      waybill: "8327967800746",
      tracking_events: events,
      last_webhook: { current_status: "PICKUP EXCEPTION", scans: [{ status: "X-PNP" }] },
    })
    expect(h.events).toHaveLength(2)
    expect(h.last_webhook).toBeDefined()
    expect(h.final_status).toBe("PICKUP EXCEPTION")
  })

  it("falls back to the last scan when the webhook names no status", () => {
    const h = captureTrackingHistory({ tracking_events: events })
    expect(h.final_status).toBe("PICKUP EXCEPTION")
    expect(h.last_webhook).toBeUndefined()
  })

  it("reads shipment_status when current_status is absent", () => {
    const h = captureTrackingHistory({
      last_webhook: { shipment_status: "IN TRANSIT" },
    })
    expect(h.final_status).toBe("IN TRANSIT")
  })

  /** A waybill that never moved has no history — record nothing rather than an
   *  empty shell that reads as "we looked and there was nothing". */
  it("returns undefined when there is nothing to remember", () => {
    expect(captureTrackingHistory({ waybill: "x" })).toBeUndefined()
    expect(captureTrackingHistory({ tracking_events: [] })).toBeUndefined()
    expect(captureTrackingHistory(null)).toBeUndefined()
    expect(captureTrackingHistory(undefined)).toBeUndefined()
  })

  /**
   * 🔴 The ordering guarantee. `planCancelledFulfillmentData` nulls the
   * telemetry keys now, so a capture that ran AFTER it would preserve nothing.
   */
  it("🔴 survives the nulling that follows it", () => {
    const { planCancelledFulfillmentData } = require("../cancel-shipment")
    const data = { waybill: "8327967800746", tracking_events: events }
    const history = captureTrackingHistory(data)
    const next = planCancelledFulfillmentData(data, {
      carrier: "shiprocket",
      awb: "8327967800746",
      cancelled_at: "2026-09-16T07:50:48.880Z",
      tracking_history: history,
    } as any)

    // cleared off `data` …
    expect(next.tracking_events).toBeNull()
    expect(next.last_webhook).toBeNull()
    // … and alive inside the record that replaced it.
    expect(next.cancelled_shipments[0].tracking_history.events).toHaveLength(2)
    expect(next.cancelled_shipments[0].awb).toBe("8327967800746")
  })
})

/**
 * 🔴 The WIRING, not just the parts.
 *
 * The first version of these tests exercised `captureTrackingHistory` directly
 * and passed a mutation that replaced the record's `tracking_history` with
 * `undefined` — proving the helper worked while saying nothing about whether
 * anything used it. A test that cannot fail when the feature is unplugged is
 * not testing the feature.
 */
describe("buildCancellationRecord", () => {
  const { buildCancellationRecord } = require("../cancel-shipment")

  const data = {
    waybill: "8327967800746",
    tracking_events: [
      { status: "OUT FOR PICKUP" },
      { status: "PICKUP EXCEPTION" },
    ],
    last_webhook: { current_status: "PICKUP EXCEPTION" },
  }

  it("🔴 carries the dead waybill's history into the record", () => {
    const r = buildCancellationRecord({
      carrier: "shiprocket",
      awb: "8327967800746",
      cancelledAt: "2026-09-16T07:50:48.880Z",
      reason: "AWB not picked up",
      data,
    })
    expect(r.tracking_history?.events).toHaveLength(2)
    expect(r.tracking_history?.final_status).toBe("PICKUP EXCEPTION")
    expect(r.awb).toBe("8327967800746")
    expect(r.reason).toBe("AWB not picked up")
  })

  it("records no reversal as null rather than omitting it", () => {
    const r = buildCancellationRecord({
      cancelledAt: "2026-09-16T07:50:48.880Z",
      data: null,
    })
    expect(r.shipping_reversed).toBeNull()
    expect(r.tracking_history).toBeUndefined()
  })

  it("keeps the partner's freight reversal when there was one", () => {
    const r = buildCancellationRecord({
      cancelledAt: "2026-09-16T07:50:48.880Z",
      shippingReversed: { amount: 1876, currency_code: "inr" },
      data: null,
    })
    expect(r.shipping_reversed).toEqual({ amount: 1876, currency_code: "inr" })
  })
})
