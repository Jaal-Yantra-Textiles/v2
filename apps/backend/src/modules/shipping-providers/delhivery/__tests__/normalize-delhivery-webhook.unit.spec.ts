import {
  delhiveryScanType,
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
})
