import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { attachInventoryOrderExternalAwb } from "../attach-inventory-order-external-awb"
import { ORDER_INVENTORY_MODULE } from "../../../modules/inventory_orders"
import { FULLFILLED_ORDERS_MODULE } from "../../../modules/fullfilled_orders"

/** A container holding one inventory order with the given shipments. */
function fakeContainer(shipments: any[] = [], metadata: any = { note: "keep me" }) {
  const calls = { shipments: [] as any[], links: [] as any[], orderUpdates: [] as any[], activities: [] as any[] }
  const services: Record<string, any> = {
    [ContainerRegistrationKeys.QUERY]: {
      graph: async ({ filters }: any) => ({
        data: filters.id === "inv_order_1" ? [{ id: "inv_order_1", metadata, inventory_shipments: shipments }] : [],
      }),
    },
    [ContainerRegistrationKeys.LINK]: { create: async (l: any) => calls.links.push(l) },
    [ContainerRegistrationKeys.LOGGER]: { warn: () => {} },
    [FULLFILLED_ORDERS_MODULE]: {
      createInventoryShipments: async (row: any) => {
        calls.shipments.push(row)
        return { id: "ishp_1", ...row }
      },
    },
    [ORDER_INVENTORY_MODULE]: {
      updateInventoryOrders: async (u: any) => calls.orderUpdates.push(u),
      createInventoryOrderActivities: async (a: any) => calls.activities.push(a),
    },
  }
  return { container: { resolve: (k: string) => services[k] } as any, calls }
}

const input = {
  orderId: "inv_order_1",
  awb: " 7D138870713 ",
  carrier: "DTDC",
  trackingUrl: "https://www.dtdc.com/tracking.asp?awb=7D138870713",
  weightGrams: 26000,
  notes: "Booked direct with DTDC (hub A47)",
  actingEmail: "admin@example.com",
}

describe("attachInventoryOrderExternalAwb", () => {
  it("records the waybill as a shipment linked to the order, mirrors it and logs it", async () => {
    const { container, calls } = fakeContainer()
    const result = await attachInventoryOrderExternalAwb(container, input)

    expect(result).toEqual(
      expect.objectContaining({ id: "ishp_1", awb: "7D138870713", carrier: "dtdc", status: "created" })
    )
    expect(calls.shipments[0]).toEqual(
      expect.objectContaining({ carrier: "dtdc", awb: "7D138870713", tracking_number: "7D138870713", status: "created", weight_grams: 26000 })
    )
    expect(calls.links[0][0][ORDER_INVENTORY_MODULE]).toEqual({ inventory_orders_id: "inv_order_1" })
    expect(calls.links[0][0][FULLFILLED_ORDERS_MODULE]).toEqual({ inventory_shipment_id: "ishp_1" })

    const meta = calls.orderUpdates[0].metadata
    expect(meta.note).toBe("keep me")
    expect(meta.partner_tracking_number).toBe("7D138870713")
    expect(meta.shipment).toEqual(expect.objectContaining({ awb: "7D138870713", shipment_id: "ishp_1", external: true }))

    expect(calls.activities[0]).toEqual(
      expect.objectContaining({ inventory_order_id: "inv_order_1", kind: "shipment_attached", actor_id: "admin@example.com" })
    )
  })

  it("refuses an AWB already live on the order", async () => {
    const { container, calls } = fakeContainer([{ id: "ishp_0", awb: "7D138870713", status: "created" }])
    await expect(attachInventoryOrderExternalAwb(container, input)).rejects.toMatchObject({
      type: MedusaError.Types.NOT_ALLOWED,
    })
    expect(calls.shipments).toHaveLength(0)
  })

  it("allows re-attaching an AWB whose earlier shipment was cancelled", async () => {
    const { container, calls } = fakeContainer([{ id: "ishp_0", awb: "7D138870713", status: "cancelled" }])
    await attachInventoryOrderExternalAwb(container, input)
    expect(calls.shipments).toHaveLength(1)
  })

  it("404s an unknown order", async () => {
    const { container } = fakeContainer()
    await expect(
      attachInventoryOrderExternalAwb(container, { ...input, orderId: "inv_order_nope" })
    ).rejects.toMatchObject({ type: MedusaError.Types.NOT_FOUND })
  })
})
