import {
  delhiveryScanType,
  delhiveryTimestamp,
  normalizeDelhiveryWebhook,
} from "../client"

/**
 * Delhivery status pushes, normalized into the same `TrackingResult` shape as
 * Shiprocket's so the one webhook route and the poll job can both feed the
 * shared sync workflows.
 *
 * Tested against the documented push envelope rather than a live account —
 * Delhivery has to enable the push per-account, so there is nothing to call.
 */
describe("delhiveryScanType", () => {
  it("prefers the typed status code", () => {
    expect(delhiveryScanType("DL", "anything")).toBe("delivered")
    expect(delhiveryScanType("RT", "anything")).toBe("rto")
  })

  it("falls back to the free-text status", () => {
    expect(delhiveryScanType(undefined, "Delivered")).toBe("delivered")
    expect(delhiveryScanType("UD", "Out for delivery")).toBe("shipped")
    expect(delhiveryScanType("UD", "In Transit")).toBe("in_transit")
    expect(delhiveryScanType("UD", "Manifested")).toBe("created")
    expect(delhiveryScanType(undefined, "RTO In Transit")).toBe("rto")
  })

  it("treats an unrecognised live scan as in transit, never as delivered", () => {
    // Guessing "delivered" from an unknown scan would close an order that is
    // still in the network.
    expect(delhiveryScanType("UD", "Some new scan name")).toBe("in_transit")
    expect(delhiveryScanType(undefined, undefined)).toBe("in_transit")
    expect(delhiveryScanType("", "")).toBe("in_transit")
  })
})

describe("normalizeDelhiveryWebhook", () => {
  const push = {
    Shipment: {
      AWB: "1234567890",
      Status: {
        Status: "Delivered",
        StatusType: "DL",
        StatusDateTime: "2026-08-04T11:20:00",
        StatusLocation: "Bengaluru_Hub",
      },
      ExpectedDeliveryDate: "2026-08-04",
      Scans: [
        {
          ScanDetail: {
            Scan: "In Transit",
            ScanType: "UD",
            StatusType: "UD",
            ScanDateTime: "2026-08-02T09:00:00",
            ScannedLocation: "Mumbai_Hub",
          },
        },
        {
          ScanDetail: {
            Scan: "Delivered",
            StatusType: "DL",
            ScanDateTime: "2026-08-04T11:20:00",
            ScannedLocation: "Bengaluru_Hub",
          },
        },
      ],
    },
  }

  it("pulls the AWB, current status and events out of the nested envelope", () => {
    const out = normalizeDelhiveryWebhook(push)
    expect(out.carrier).toBe("delhivery")
    expect(out.awb).toBe("1234567890")
    expect(out.current_status).toBe("Delivered")
    expect(out.current_status_code).toBe("DL")
    expect(out.estimated_delivery).toBe("2026-08-04")
    expect(out.events).toHaveLength(2)
    expect(out.events[0]).toMatchObject({
      status: "In Transit",
      location: "Mumbai_Hub",
      scan_type: "in_transit",
    })
    expect(out.events[1]).toMatchObject({
      status: "Delivered",
      scan_type: "delivered",
    })
  })

  it("accepts the flatter shape some accounts receive", () => {
    const out = normalizeDelhiveryWebhook({
      waybill: "999",
      status: { status: "In Transit", statusType: "UD" },
    })
    expect(out.awb).toBe("999")
    expect(out.current_status).toBe("In Transit")
  })

  it("returns an empty AWB for junk rather than throwing", () => {
    // The webhook route treats a missing AWB as "ignore this push"; throwing
    // here would turn a carrier test-ping into a logged error.
    expect(normalizeDelhiveryWebhook({}).awb).toBe("")
    expect(normalizeDelhiveryWebhook(null).awb).toBe("")
    expect(normalizeDelhiveryWebhook(undefined).events).toEqual([])
  })

  it("keeps the raw payload for the audit trail", () => {
    expect(normalizeDelhiveryWebhook(push).raw).toBe(push)
  })

  /**
   * The payload printed in Delhivery's own webhook requirement document.
   *
   * It is flat, its `status` is a bare string, and it carries NO `AWB` or
   * `Waybill` key — the consignment number rides in `lrnum`. Parsed with only
   * the nested envelope in mind it yields `awb: ""`, and the webhook route
   * reads an empty AWB as "ignore this push". A real delivery would have been
   * dropped with nothing in the log but "test webhook?".
   */
  describe("the flat scan push from the requirement document", () => {
    const flat = {
      shipment_remark: "Delivered to consignee",
      location: "Bengaluru_Hub",
      count: 1,
      lrnum: "1234567890",
      mwn: "MWN-1",
      cl_uuid: "abc",
      name: "Jaal Yantra Textiles",
      package_type: "Pre-paid",
      expected_delivery_date: 1754300000,
      promised_delivery_date: 1754300000,
      timestamp: 1754305200,
      status: "Delivered",
    }

    it("finds the AWB in lrnum", () => {
      expect(normalizeDelhiveryWebhook(flat).awb).toBe("1234567890")
    })

    it("reads a bare-string status", () => {
      const out = normalizeDelhiveryWebhook(flat)
      expect(out.current_status).toBe("Delivered")
      expect(out.estimated_delivery).toBe("2025-08-04T09:33:20.000Z")
    })

    it("synthesises the single scan as an event", () => {
      const out = normalizeDelhiveryWebhook(flat)
      expect(out.events).toHaveLength(1)
      expect(out.events[0]).toMatchObject({
        status: "Delivered",
        location: "Bengaluru_Hub",
        scan_type: "delivered",
      })
      expect(out.events[0].timestamp).toBe("2025-08-04T11:00:00.000Z")
    })

    it("falls back to the master waybill when there is no lrnum", () => {
      const { lrnum, ...noLr } = flat
      expect(normalizeDelhiveryWebhook(noLr).awb).toBe("MWN-1")
    })

    it("still refuses to invent a delivery from an unknown status", () => {
      const out = normalizeDelhiveryWebhook({ ...flat, status: "Some new scan", shipment_remark: "" })
      expect(out.events[0].scan_type).toBe("in_transit")
    })

    it("does not synthesise an event when there is no AWB to match", () => {
      // A carrier test-ping must not become a phantom scan on nothing.
      expect(normalizeDelhiveryWebhook({ status: "Delivered" }).events).toEqual([])
    })
  })
})

describe("delhiveryTimestamp", () => {
  it("accepts epoch seconds and milliseconds alike", () => {
    expect(delhiveryTimestamp(1754305200)).toBe("2025-08-04T11:00:00.000Z")
    expect(delhiveryTimestamp(1754305200000)).toBe("2025-08-04T11:00:00.000Z")
  })

  it("passes an ISO string through", () => {
    expect(delhiveryTimestamp("2026-08-04T11:20:00")).toBe("2026-08-04T11:20:00")
  })

  it("yields empty for nothing, never 1970", () => {
    expect(delhiveryTimestamp(undefined)).toBe("")
    expect(delhiveryTimestamp(null)).toBe("")
    expect(delhiveryTimestamp("")).toBe("")
    expect(delhiveryTimestamp(0)).toBe("")
  })
})
