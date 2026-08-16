import {
  planDetachedFulfillmentData,
  planExternalAttachData,
  resolveExternalAwbNotify,
  type ExternalAttachment,
} from "../external-awb"

/**
 * The manual override: a waybill we did not book. No carrier API is involved in
 * either direction, so these two planners ARE the feature — everything else is
 * persistence.
 */

const ATTACHMENT: ExternalAttachment = {
  carrier: "dtdc",
  awb: "D1234567890",
  attached_at: "2026-08-14T08:00:00.000Z",
  attached_by: "ops@jaalyantra.com",
  notes: "booked at the DTDC counter, our portal was down",
}

describe("planExternalAttachData", () => {
  it("stamps the refs the label and tracking routes read", () => {
    const next = planExternalAttachData(null, {
      carrier: "dtdc",
      awb: "D1234567890",
      trackingUrl: "https://dtdc.in/track/D1234567890",
      attachment: ATTACHMENT,
    })
    expect(next.carrier).toBe("dtdc")
    expect(next.waybill).toBe("D1234567890")
    expect(next.tracking_number).toBe("D1234567890")
    expect(next.tracking_url).toBe("https://dtdc.in/track/D1234567890")
    expect(next.provider_refs).toEqual({ waybill: "D1234567890" })
  })

  it("marks the parcel external so the UI stops offering what we cannot do", () => {
    const next = planExternalAttachData(null, {
      carrier: "dtdc",
      awb: "D1234567890",
      attachment: ATTACHMENT,
    })
    // No label to regenerate and no rate to quote for a parcel we did not book.
    expect(next.external_attachment).toEqual(ATTACHMENT)
  })

  it("keeps unrelated fulfillment data", () => {
    const next = planExternalAttachData(
      { pickup_location_name: "DHM-Main", weight_grams: 500 },
      { carrier: "dtdc", awb: "D1", attachment: ATTACHMENT }
    )
    expect(next.pickup_location_name).toBe("DHM-Main")
    expect(next.weight_grams).toBe(500)
  })

  it("appends to the attachment history rather than replacing it", () => {
    const first = planExternalAttachData(null, {
      carrier: "dtdc",
      awb: "D1",
      attachment: { ...ATTACHMENT, awb: "D1" },
    })
    const second = planExternalAttachData(first, {
      carrier: "india post",
      awb: "IP2",
      attachment: { ...ATTACHMENT, carrier: "india post", awb: "IP2" },
    })
    expect(second.external_attachments).toHaveLength(2)
    expect(second.external_attachments[1].awb).toBe("IP2")
  })

  it("defaults the optional urls to empty rather than undefined", () => {
    const next = planExternalAttachData(null, {
      carrier: "dtdc",
      awb: "D1",
      attachment: ATTACHMENT,
    })
    expect(next.tracking_url).toBe("")
    expect(next.label_url).toBe("")
  })

  it("tolerates a corrupt history rather than throwing on it", () => {
    const next = planExternalAttachData(
      { external_attachments: "corrupted" as any },
      { carrier: "dtdc", awb: "D1", attachment: ATTACHMENT }
    )
    expect(next.external_attachments).toEqual([ATTACHMENT])
  })
})

describe("planDetachedFulfillmentData", () => {
  const RECORD = {
    awb: "D1234567890",
    carrier: "dtdc",
    detached_at: "2026-08-14T09:00:00.000Z",
    detached_by: "ops@jaalyantra.com",
    reason: "cancelled at the DTDC counter",
  }

  it("NULLS every ref — deleting does not survive the jsonb merge", () => {
    // The order 83 lesson: `updateFulfillment` merges `data`, so a removed key
    // is re-supplied from the stored row and the fulfillment goes on
    // advertising a waybill nobody claims.
    const next = planDetachedFulfillmentData(
      {
        carrier: "dtdc",
        waybill: "D1234567890",
        tracking_number: "D1234567890",
        tracking_url: "https://dtdc.in/track",
        label_url: "https://label.pdf",
        shipment_id: "s1",
        sr_order_id: "sr1",
        provider_refs: { waybill: "D1234567890" },
        external_attachment: ATTACHMENT,
      },
      RECORD
    )
    for (const key of [
      "carrier",
      "waybill",
      "tracking_number",
      "tracking_url",
      "label_url",
      "shipment_id",
      "sr_order_id",
      "provider_refs",
      "external_attachment",
    ]) {
      expect(next).toHaveProperty(key)
      expect(next[key]).toBeNull()
    }
  })

  it("keeps the attachment history — the AWB is the handle for a courier invoice", () => {
    const attached = planExternalAttachData(null, {
      carrier: "dtdc",
      awb: "D1234567890",
      attachment: ATTACHMENT,
    })
    const next = planDetachedFulfillmentData(attached, RECORD)
    // A detach means "no longer ours to show", not "never happened".
    expect(next.external_attachments).toHaveLength(1)
    expect(next.detached_shipments).toEqual([RECORD])
  })

  it("appends so a second detach keeps the first", () => {
    const once = planDetachedFulfillmentData({ waybill: "A" }, RECORD)
    const twice = planDetachedFulfillmentData(
      { ...once, waybill: "B" },
      { ...RECORD, awb: "B" }
    )
    expect(twice.detached_shipments).toHaveLength(2)
  })

  it("keeps unrelated data and survives an empty fulfillment", () => {
    expect(
      planDetachedFulfillmentData({ pickup_location_name: "DHM" }, RECORD)
        .pickup_location_name
    ).toBe("DHM")
    expect(planDetachedFulfillmentData(null, RECORD).detached_shipments).toEqual([
      RECORD,
    ])
  })

  it("leaves the refs falsy, which is what every reader actually tests", () => {
    const next = planDetachedFulfillmentData({ waybill: "A", carrier: "dtdc" }, RECORD)
    expect(next.waybill).toBeFalsy()
    expect(next.carrier).toBeFalsy()
  })
})

describe("resolveExternalAwbNotify", () => {
  it("emails when a waybill on this fulfillment was cancelled first", () => {
    // cancel-shipment promised "we'll send you a fresh one as soon as the new
    // courier has collected your parcel". This is the only thing that keeps it.
    expect(
      resolveExternalAwbNotify({
        cancelled_shipments: [{ carrier: "bluedart", awb: "21091376574" }],
      })
    ).toBe(true)
  })

  it("stays silent on a first attach — nothing was promised", () => {
    expect(resolveExternalAwbNotify({})).toBe(false)
    expect(resolveExternalAwbNotify(null)).toBe(false)
    expect(resolveExternalAwbNotify(undefined)).toBe(false)
    // Present but empty is a fulfillment that never had a cancel.
    expect(resolveExternalAwbNotify({ cancelled_shipments: [] })).toBe(false)
  })

  it("lets the operator override in both directions", () => {
    expect(
      resolveExternalAwbNotify({ cancelled_shipments: [{ awb: "x" }] }, false)
    ).toBe(false)
    expect(resolveExternalAwbNotify({}, true)).toBe(true)
  })

  it("does not treat a corrupt history as a cancellation", () => {
    // Same tolerance the planners already have: jsonb is not a schema.
    expect(
      resolveExternalAwbNotify({ cancelled_shipments: "not-an-array" as any })
    ).toBe(false)
    expect(resolveExternalAwbNotify({ cancelled_shipments: 3 as any })).toBe(
      false
    )
  })
})
