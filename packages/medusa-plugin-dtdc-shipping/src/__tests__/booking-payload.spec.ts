import { DtdcProviderAdapter } from "../providers/dtdc/adapter"
import { DtdcClient } from "../lib/dtdc-client"
import type { CreateShipmentInput } from "../lib/provider-interface"

// The HR Handloom inventory order (2026-10-13): 18 fabrics, 10 m each.
const EIGHTEEN_FABRICS = Array.from({ length: 18 }, (_, i) => ({
  name: `Kala Cotton Handwoven Fabric — Colour ${i + 1}`,
  sku: `KC-${i + 1}`,
  quantity: 10,
  price: 380,
}))

const input = {
  reference_id: "inv_order_x",
  payment_mode: "prepaid",
  pickup_location_name: "",
  from: { name: "HR Handloom", phone: "9586757384", address_1: "Bhujodi", city: "Bhuj", state: "Gujarat", pincode: "370020", country: "IN" },
  to: { name: "Dharamshala", phone: "1", address_1: "a", city: "Dharamshala", state: "HP", pincode: "176215", country: "IN" },
  items: EIGHTEEN_FABRICS,
  weight_grams: 26000,
  dimensions_cm: { length: 50, width: 40, height: 30 },
  preferred_courier_id: "B2C PRIORITY",
} as unknown as CreateShipmentInput

/** The consignment the client would POST, with the network stubbed out. */
async function postedConsignment(): Promise<any> {
  const adapter = new DtdcProviderAdapter({ customer_code: "CC", api_key: "k" } as any)
  const client = (adapter as any).client as DtdcClient
  let body: any
  ;(client as any).fetch_ = async (_url: string, init: any) => {
    body = JSON.parse(init.body)
    return {
      ok: true,
      json: async () => ({ status: "OK", data: [{ success: true, reference_number: "AWB1" }] }),
    }
  }
  await adapter.createShipment(input).catch(() => undefined)
  return body.consignments[0]
}

describe("DTDC booking payload", () => {
  it("books ONE box, not one per unit (180 m of fabric was sent as 180 boxes)", async () => {
    const c = await postedConsignment()
    expect(c.num_pieces).toBe("1")
    expect(c.weight).toBe("26")
  })

  it("never sends a description of 250+ characters", async () => {
    const c = await postedConsignment()
    expect(c.description.length).toBeLessThan(250)
  })
})
