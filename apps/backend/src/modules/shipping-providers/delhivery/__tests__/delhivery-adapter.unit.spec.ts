import { DelhiveryProviderAdapter } from "../adapter"
import type { CreateShipmentInput } from "../../provider-interface"

/**
 * The Delhivery adapter drives Delhivery's DOMESTIC Express API. Two things it
 * has to get right, both verified against the live account on 2026-08-06:
 *
 * 1. It must refuse an export. Delhivery's exports are Cross Border, a separate
 *    Delhivery One service with its own KYC and order object, absent from the
 *    Express API entirely. Handed a foreign destination the domestic API gives
 *    nothing actionable — serviceability for a US ZIP returns
 *    `{"delivery_codes": []}` and the rate API answers a bare
 *    `400 "Unable to process request, Please contact: lastmile-integration@…"`.
 * 2. It must send `hsn_code`, which Delhivery lists as mandatory on order
 *    creation next to `seller_gst_tin`. The adapter was dropping it even though
 *    the shared builder resolves one per line (#1206).
 */

const createShipment = jest.fn().mockResolvedValue({
  packages: [{ waybill: "1411236369" }],
})
const calculateShippingCost = jest.fn().mockResolvedValue([{ total_amount: 56.79 }])

jest.mock("../client", () => ({
  DelhiveryClient: jest.fn().mockImplementation(() => ({
    createShipment,
    calculateShippingCost,
  })),
}))

const adapter = () => new DelhiveryProviderAdapter({ api_token: "t" })

const input = (overrides: Partial<CreateShipmentInput> = {}): CreateShipmentInput =>
  ({
    reference_id: "order_1",
    payment_mode: "prepaid",
    pickup_location_name: "JYT Warehouse",
    to: {
      name: "Test Consignee",
      phone: "9999999999",
      address_1: "1 Test Street",
      city: "Mumbai",
      pincode: "400001",
      state: "Maharashtra",
      country: "IN",
    },
    items: [{ name: "Kala Cotton Shirt", quantity: 1, unit_price: 1200 }],
    weight_grams: 500,
    ...overrides,
  }) as CreateShipmentInput

beforeEach(() => {
  createShipment.mockClear()
  calculateShippingCost.mockClear()
})

describe("international destinations", () => {
  it("refuses to create a shipment and names the way out", async () => {
    await expect(
      adapter().createShipment(
        input({ to: { ...input().to, country: "US", pincode: "10001" } as any })
      )
    ).rejects.toThrow(/Cross Border|Use Shiprocket/)

    // Nothing may reach the domestic endpoint — a foreign postcode in `pin`
    // would either be rejected opaquely or manifest something undeliverable.
    expect(createShipment).not.toHaveBeenCalled()
  })

  it("refuses to quote a rate", async () => {
    await expect(
      adapter().getRates({
        origin_pincode: "110001",
        destination_pincode: "10001",
        destination_country: "US",
        weight_grams: 500,
      })
    ).rejects.toThrow(/Cross Border/)
    expect(calculateShippingCost).not.toHaveBeenCalled()
  })

  it("still ships domestically — 'IN', 'India' and an absent country all pass", async () => {
    for (const country of ["IN", "India", undefined]) {
      await adapter().createShipment(
        input({ to: { ...input().to, country } as any })
      )
    }
    expect(createShipment).toHaveBeenCalledTimes(3)

    // A rate query with no destination_country is domestic by definition — the
    // field is optional and every existing caller omits it.
    await adapter().getRates({
      origin_pincode: "110001",
      destination_pincode: "400001",
      weight_grams: 500,
    })
    expect(calculateShippingCost).toHaveBeenCalled()
  })
})

describe("hsn_code", () => {
  it("forwards the first line that resolves one", async () => {
    await adapter().createShipment(
      input({
        items: [
          { name: "Ad-hoc line", quantity: 1, unit_price: 100 },
          { name: "Shirt", quantity: 1, unit_price: 1200, hsn: "62052000" },
          { name: "Scarf", quantity: 1, unit_price: 400, hsn: "62142000" },
        ],
      })
    )
    // Delhivery takes ONE code per shipment, not one per line.
    expect(createShipment.mock.calls[0][0].hsn_code).toBe("62052000")
  })

  it("sends no hsn_code when no line has one, rather than an empty string", async () => {
    await adapter().createShipment(input())
    expect(createShipment.mock.calls[0][0].hsn_code).toBeUndefined()
  })

  it("ignores a blank code", async () => {
    await adapter().createShipment(
      input({ items: [{ name: "Shirt", quantity: 1, unit_price: 1, hsn: "   " }] })
    )
    expect(createShipment.mock.calls[0][0].hsn_code).toBeUndefined()
  })
})
