/**
 * A Delhivery shipment for an inventory order (GOF → Dharamshala, 2026-11-25):
 * the label said "Inventory item ₹0.00", no label reached the partner and no
 * pickup was booked. Pinned here against the Delhivery stub, which — like the
 * real API — refuses a manifest whose warehouse is not in Delhivery's registry.
 */
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import {
  delhiveryStubState,
  resetDelhiveryStub,
} from "../../src/modules/shipping-providers/delhivery/stub-fetch"
import { FULLFILLED_ORDERS_MODULE } from "../../src/modules/fullfilled_orders"

jest.setTimeout(90 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let headers: any
  const env: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const k of ["DELHIVERY_API_TOKEN", "DELHIVERY_STUB"]) env[k] = process.env[k]
    process.env.DELHIVERY_API_TOKEN = "test-delhivery-token"
    process.env.DELHIVERY_STUB = "1"
  })
  afterAll(() => {
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  beforeEach(async () => {
    resetDelhiveryStub()
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  const order = async () => {
    const item = await api.post("/admin/inventory-items", { title: "40s+60s 6PLY White HandWoven 36in" }, headers)
    const to = await api.post(
      "/admin/stock-locations",
      { name: "Dharamshala", address: { address_1: "Ram Nagar Road", city: "Dharamshala", province: "HP", postal_code: "176215", country_code: "in", phone: "7580067026" } },
      headers
    )
    const from = await api.post(
      "/admin/stock-locations",
      { name: "GOF Warehouse", address: { address_1: "Chak Mandal Para", city: "Domkal", province: "WB", postal_code: "742304", country_code: "in", phone: "9998887771" } },
      headers
    )
    const res = await api.post(
      "/admin/inventory-orders",
      {
        order_lines: [{ inventory_item_id: item.data.inventory_item.id, quantity: 111, price: 135 }],
        quantity: 111,
        total_price: 14985,
        status: "Ready for Delivery",
        expected_delivery_date: new Date().toISOString(),
        order_date: new Date().toISOString(),
        shipping_address: {},
        stock_location_id: to.data.stock_location.id,
        from_stock_location_id: from.data.stock_location.id,
      },
      headers
    )
    return res.data.inventoryOrder.id as string
  }

  it("manifests at Delhivery's own warehouse with the real contents and value, books the pickup with a time, and returns the PDF label", async () => {
    const id = await order()
    const res = await api.post(
      `/admin/inventory-orders/${id}/shipment`,
      { carrier: "delhivery", weight_grams: 5000, pickup_date: "2026-11-26" },
      headers
    )
    expect(res.status).toBe(200)

    // Delhivery's registry, not Shiprocket's: the stub refuses an unknown name.
    const manifest = delhiveryStubState.lastManifestBody
    const shipped = manifest?.shipments?.[0] ?? {}
    expect(delhiveryStubState.registeredWarehouses.has(manifest?.pickup_location?.name)).toBe(true)
    expect(shipped.products_desc).toBe("40s+60s 6PLY White HandWoven 36in × 111")
    expect(Number(shipped.total_amount)).toBe(14985)

    const shipment = res.data.shipment
    expect(shipment.pickup?.scheduled_date).toBe("2026-11-26")
    expect(shipment.pickup_error).toBeUndefined()
    expect(shipment.label_url).toBe("https://stub.invalid/label.pdf")

    // The persisted row says what really happened.
    const rows = await getContainer().resolve(FULLFILLED_ORDERS_MODULE).listInventoryShipments({ id: shipment.shipment_id })
    expect(rows[0]).toMatchObject({ status: "pickup_scheduled", pickup_scheduled_date: "2026-11-26" })
  })

  it("without a date books no pickup and claims none", async () => {
    const id = await order()
    const res = await api.post(`/admin/inventory-orders/${id}/shipment`, { carrier: "delhivery" }, headers)
    expect(res.status).toBe(200)
    const rows = await getContainer().resolve(FULLFILLED_ORDERS_MODULE).listInventoryShipments({ id: res.data.shipment.shipment_id })
    expect(rows[0]).toMatchObject({ status: "created", pickup_scheduled_date: null })
  })
})
