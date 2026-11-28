import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../../modules/fullfilled_orders"
import {
  completeManualInventoryShipment,
  requestManualInventoryShipment,
} from "../manual-inventory-shipment"
import { isInlineOriginCarrier, isManualBookingCarrier } from "../lib/manual-carriers"
import { labelBase64 } from "../lib/store-label-pdf"

const makeContainer = (order: any) => {
  const created: any[] = []
  const updated: any[] = []
  const orderUpdates: any[] = []
  const activities: any[] = []
  const events: any[] = []
  const services: Record<string, any> = {
    [ContainerRegistrationKeys.QUERY]: {
      graph: async ({ entity }: any) =>
        entity === "inventory_orders" ? { data: order ? [order] : [] } : { data: [] },
    },
    [FULLFILLED_ORDERS_MODULE]: {
      createInventoryShipments: async (row: any) => {
        created.push(row)
        return { id: "ishp_new", ...row }
      },
      updateInventoryShipments: async (row: any) => updated.push(row),
    },
    [ContainerRegistrationKeys.LINK]: { create: async () => undefined },
    [ORDER_INVENTORY_MODULE]: {
      createInventoryOrderActivities: async (a: any) => activities.push(a),
      updateInventoryOrders: async (o: any) => orderUpdates.push(o),
    },
    [Modules.EVENT_BUS]: { emit: async (e: any) => events.push(e) },
    [ContainerRegistrationKeys.LOGGER]: { warn: () => undefined },
  }
  return { container: { resolve: (k: string) => services[k] } as any, created, updated, orderUpdates, activities, events }
}

describe("carrier kinds", () => {
  it("knows which carriers are manual and which take an inline origin", () => {
    expect(isManualBookingCarrier("India_Post")).toBe(true)
    expect(isManualBookingCarrier("dtdc")).toBe(false)
    expect(isInlineOriginCarrier("DTDC")).toBe(true)
    expect(isInlineOriginCarrier("shiprocket")).toBe(false)
  })

  it("recognises a base64 PDF label and ignores links", () => {
    expect(labelBase64({ data: "J".repeat(200), format: "pdf" })).toBe("J".repeat(200))
    expect(labelBase64({ label_url: "https://x/y.pdf" })).toBeNull()
    expect(labelBase64({ data: "short", format: "pdf" })).toBeNull()
  })
})

describe("requestManualInventoryShipment", () => {
  it("stores a booking_pending row with no AWB and never touches metadata.shipment", async () => {
    const t = makeContainer({ id: "inv_1", inventory_shipments: [] })
    const out = await requestManualInventoryShipment(t.container, {
      orderId: "inv_1",
      carrier: "india_post",
      pickupStockLocationId: "sloc_a",
      weightGrams: 900,
      notes: "fragile",
      actingEmail: "p@x.com",
    })
    expect(out).toEqual({ id: "ishp_new", carrier: "india_post", status: "booking_pending", awb: null, pending: true })
    expect(t.created[0]).toMatchObject({ carrier: "india_post", status: "booking_pending", awb: null, pickup_stock_location_id: "sloc_a", weight_grams: 900 })
    expect(t.created[0].metadata.manual_booking).toMatchObject({ requested_by: "p@x.com", notes: "fragile" })
    expect(t.orderUpdates).toHaveLength(0)
    expect(t.activities[0].kind).toBe("shipment_booking_requested")
  })

  it("refuses a second open request and an API carrier", async () => {
    const t = makeContainer({ id: "inv_1", inventory_shipments: [{ id: "s1", status: "booking_pending", carrier: "india_post" }] })
    await expect(requestManualInventoryShipment(t.container, { orderId: "inv_1", carrier: "india_post" })).rejects.toThrow(/already waiting/)
    await expect(requestManualInventoryShipment(t.container, { orderId: "inv_1", carrier: "dtdc" })).rejects.toThrow(/not a manually booked/)
  })
})

describe("completeManualInventoryShipment", () => {
  const pending = { id: "s1", carrier: "india_post", status: "booking_pending", awb: null, metadata: { manual_booking: { requested_by: "p@x.com" } } }

  it("fills the AWB + label on the pending row, moves it to created and emits the event", async () => {
    const t = makeContainer({ id: "inv_1", metadata: { keep: 1 }, inventory_shipments: [pending] })
    const out = await completeManualInventoryShipment(t.container, {
      orderId: "inv_1",
      shipmentId: "s1",
      awb: " EK123456789IN ",
      labelUrl: "https://files/label.pdf",
      actingEmail: "admin@x.com",
    })
    expect(out).toMatchObject({ id: "s1", awb: "EK123456789IN", status: "created", label_url: "https://files/label.pdf" })
    expect(t.updated[0]).toMatchObject({ id: "s1", awb: "EK123456789IN", tracking_number: "EK123456789IN", status: "created", label_url: "https://files/label.pdf" })
    expect(t.updated[0].metadata.manual_booking).toMatchObject({ requested_by: "p@x.com", booked_by: "admin@x.com" })
    expect(t.orderUpdates[0].metadata).toMatchObject({ keep: 1, partner_tracking_number: "EK123456789IN" })
    expect(t.events[0].data).toMatchObject({ previous_status: "booking_pending", status: "created", order_id: "inv_1" })
  })

  it("refuses a row that is not pending, and a duplicate AWB", async () => {
    const t1 = makeContainer({ id: "inv_1", inventory_shipments: [{ ...pending, status: "created" }] })
    await expect(completeManualInventoryShipment(t1.container, { orderId: "inv_1", shipmentId: "s1", awb: "A1" })).rejects.toThrow(/not waiting/)
    const t2 = makeContainer({ id: "inv_1", inventory_shipments: [pending, { id: "s2", awb: "A1", status: "created" }] })
    await expect(completeManualInventoryShipment(t2.container, { orderId: "inv_1", shipmentId: "s1", awb: "A1" })).rejects.toThrow(/already on this order/)
  })
})
