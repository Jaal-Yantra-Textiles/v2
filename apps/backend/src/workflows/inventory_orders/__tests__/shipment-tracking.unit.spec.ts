import {
  appendTrackingEvent,
  resolveOrderStatusUpdate,
  shipmentStatusFromTracking,
  shouldAdvanceShipmentStatus,
} from "../lib/shipment-tracking"
import { normalizeShiprocketWebhook } from "../../../modules/shipping-providers/shiprocket/client"

describe("normalizeShiprocketWebhook (#888)", () => {
  it("parses awb, the current/shipment status pair and scans", () => {
    const result = normalizeShiprocketWebhook({
      awb: "19041424751540",
      courier_name: "Delhivery Surface",
      current_status: "IN TRANSIT",
      current_status_id: 20,
      shipment_status: "IN TRANSIT",
      shipment_status_id: 18,
      etd: "2026-07-09",
      scans: [
        { date: "2026-07-04 10:00", status: "Picked up", location: "Jaipur", "sr-status": "42" },
      ],
    })
    expect(result.carrier).toBe("shiprocket")
    expect(result.awb).toBe("19041424751540")
    expect(result.current_status).toBe("IN TRANSIT")
    expect(result.current_status_code).toBe(18)
    expect(result.estimated_delivery).toBe("2026-07-09")
    expect(result.events).toHaveLength(1)
    expect(result.events[0].status).toBe("Picked up")
  })

  it("falls back to shipment_status when current_status is absent and tolerates empty payloads", () => {
    expect(normalizeShiprocketWebhook({ shipment_status: "DELIVERED" }).current_status).toBe(
      "DELIVERED"
    )
    expect(normalizeShiprocketWebhook({}).awb).toBe("")
    expect(normalizeShiprocketWebhook(null).events).toEqual([])
  })
})

describe("shipmentStatusFromTracking (#888)", () => {
  it("maps the confirmed Shiprocket status ids", () => {
    expect(shipmentStatusFromTracking({ current_status_code: 42 })).toBe("picked_up")
    expect(shipmentStatusFromTracking({ current_status_code: 6 })).toBe("picked_up")
    expect(shipmentStatusFromTracking({ current_status_code: 7 })).toBe("delivered")
    expect(shipmentStatusFromTracking({ current_status_code: 9 })).toBe("rto")
    expect(shipmentStatusFromTracking({ current_status_code: 10 })).toBe("rto")
  })

  it("falls back to label keywords when the id is unknown", () => {
    expect(shipmentStatusFromTracking({ current_status: "PICKED UP" })).toBe("picked_up")
    expect(shipmentStatusFromTracking({ current_status: "Out For Delivery" })).toBe(
      "out_for_delivery"
    )
    expect(shipmentStatusFromTracking({ current_status: "IN TRANSIT", current_status_code: 20 })).toBe(
      "in_transit"
    )
    expect(shipmentStatusFromTracking({ current_status: "PICKUP SCHEDULED" })).toBe(
      "pickup_scheduled"
    )
    expect(shipmentStatusFromTracking({ current_status: "CANCELED" })).toBe("cancelled")
  })

  it("reads 'RTO DELIVERED' as rto, never delivered", () => {
    expect(
      shipmentStatusFromTracking({ current_status: "RTO DELIVERED", current_status_code: 10 })
    ).toBe("rto")
    expect(shipmentStatusFromTracking({ current_status: "RTO INITIATED" })).toBe("rto")
  })

  it("does not read 'UNDELIVERED' (NDR) as delivered", () => {
    expect(shipmentStatusFromTracking({ current_status: "UNDELIVERED" })).toBeNull()
  })

  it("returns null for pre-pickup noise and unknown statuses", () => {
    expect(shipmentStatusFromTracking({ current_status: "AWB ASSIGNED", current_status_code: 1 })).toBeNull()
    expect(shipmentStatusFromTracking({ current_status: "MANIFEST GENERATED", current_status_code: 5 })).toBeNull()
    expect(shipmentStatusFromTracking({})).toBeNull()
  })
})

describe("shouldAdvanceShipmentStatus (#888)", () => {
  it("moves forward along the lifecycle", () => {
    expect(shouldAdvanceShipmentStatus("created", "picked_up")).toBe(true)
    expect(shouldAdvanceShipmentStatus("pickup_scheduled", "picked_up")).toBe(true)
    expect(shouldAdvanceShipmentStatus("picked_up", "in_transit")).toBe(true)
    expect(shouldAdvanceShipmentStatus("in_transit", "delivered")).toBe(true)
    expect(shouldAdvanceShipmentStatus("out_for_delivery", "rto")).toBe(true)
  })

  it("blocks regressions and retries (idempotent)", () => {
    expect(shouldAdvanceShipmentStatus("delivered", "in_transit")).toBe(false)
    expect(shouldAdvanceShipmentStatus("in_transit", "picked_up")).toBe(false)
    expect(shouldAdvanceShipmentStatus("picked_up", "picked_up")).toBe(false)
  })

  it("treats delivered and cancelled as terminal", () => {
    expect(shouldAdvanceShipmentStatus("delivered", "rto")).toBe(false)
    expect(shouldAdvanceShipmentStatus("cancelled", "picked_up")).toBe(false)
    expect(shouldAdvanceShipmentStatus("cancelled", "delivered")).toBe(false)
  })

  it("accepts a carrier-side cancellation only pre-pickup", () => {
    expect(shouldAdvanceShipmentStatus("created", "cancelled")).toBe(true)
    expect(shouldAdvanceShipmentStatus("pickup_scheduled", "cancelled")).toBe(true)
    expect(shouldAdvanceShipmentStatus("picked_up", "cancelled")).toBe(false)
    expect(shouldAdvanceShipmentStatus("in_transit", "cancelled")).toBe(false)
  })

  it("handles null/unknown inputs safely", () => {
    expect(shouldAdvanceShipmentStatus(null, "picked_up")).toBe(true) // defaults to created
    expect(shouldAdvanceShipmentStatus("created", null)).toBe(false)
    expect(shouldAdvanceShipmentStatus("weird_status", "picked_up")).toBe(false)
  })
})

describe("resolveOrderStatusUpdate (#888 — Default behavior)", () => {
  it("advances Processing / Ready for Delivery to Shipped when goods move", () => {
    expect(resolveOrderStatusUpdate("Processing", ["picked_up"])).toBe("Shipped")
    expect(resolveOrderStatusUpdate("Ready for Delivery", ["in_transit"])).toBe("Shipped")
  })

  it("closes to Delivered only when every non-cancelled shipment is delivered", () => {
    expect(resolveOrderStatusUpdate("Shipped", ["delivered"])).toBe("Delivered")
    expect(resolveOrderStatusUpdate("Ready for Delivery", ["delivered", "delivered"])).toBe(
      "Delivered"
    )
    expect(resolveOrderStatusUpdate("Shipped", ["delivered", "in_transit"])).toBeNull()
    expect(resolveOrderStatusUpdate("Shipped", ["delivered", "cancelled"])).toBe("Delivered")
  })

  it("never touches Pending / Partial / Delivered / Cancelled orders", () => {
    expect(resolveOrderStatusUpdate("Pending", ["picked_up"])).toBeNull()
    expect(resolveOrderStatusUpdate("Partial", ["delivered"])).toBeNull()
    expect(resolveOrderStatusUpdate("Delivered", ["delivered"])).toBeNull()
    expect(resolveOrderStatusUpdate("Cancelled", ["picked_up"])).toBeNull()
  })

  it("no-ops with no active shipments or nothing moving yet", () => {
    expect(resolveOrderStatusUpdate("Processing", [])).toBeNull()
    expect(resolveOrderStatusUpdate("Processing", ["cancelled"])).toBeNull()
    expect(resolveOrderStatusUpdate("Processing", ["pickup_scheduled"])).toBeNull()
  })
})

describe("appendTrackingEvent (#888)", () => {
  const ev = (status: string, code: number | null, received = "2026-07-04T10:00:00Z") => ({
    at: null,
    received_at: received,
    status,
    status_code: code,
  })

  it("appends events and preserves the rest of the metadata blob", () => {
    const out = appendTrackingEvent({ shipment: { awb: "X" } }, ev("PICKED UP", 42), { raw: 1 })
    expect(out.shipment).toEqual({ awb: "X" })
    expect(out.tracking_events).toHaveLength(1)
    expect(out.last_webhook).toEqual({ raw: 1 })
  })

  it("skips a consecutive duplicate (webhook retry)", () => {
    const first = appendTrackingEvent(null, ev("PICKED UP", 42))
    const second = appendTrackingEvent(first, ev("PICKED UP", 42, "2026-07-04T10:05:00Z"))
    expect(second.tracking_events).toHaveLength(1)
  })

  it("appends when the status actually changed", () => {
    const first = appendTrackingEvent(null, ev("PICKED UP", 42))
    const second = appendTrackingEvent(first, ev("IN TRANSIT", 18))
    expect(second.tracking_events).toHaveLength(2)
  })

  it("caps the history at 50 entries, keeping the newest", () => {
    let meta: Record<string, any> | null = null
    for (let i = 0; i < 60; i++) {
      meta = appendTrackingEvent(meta, ev(`SCAN ${i}`, i))
    }
    expect(meta!.tracking_events).toHaveLength(50)
    expect(meta!.tracking_events[49].status).toBe("SCAN 59")
    expect(meta!.tracking_events[0].status).toBe("SCAN 10")
  })
})
