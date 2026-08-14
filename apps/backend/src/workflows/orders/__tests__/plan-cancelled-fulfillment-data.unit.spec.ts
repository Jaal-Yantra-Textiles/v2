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
