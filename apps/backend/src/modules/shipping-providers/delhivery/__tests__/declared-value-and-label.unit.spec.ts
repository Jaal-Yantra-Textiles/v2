import { DelhiveryProviderAdapter, delhiveryDeclaredValue, delhiveryProductDesc } from "../adapter"
import type { CreateShipmentInput } from "../../provider-interface"

const createShipment = jest.fn().mockResolvedValue({ packages: [{ waybill: "41712510000140" }] })
const getLabel = jest.fn()

jest.mock("../client", () => ({
  DelhiveryClient: jest.fn().mockImplementation(() => ({ createShipment, getLabel })),
}))

const base = {
  reference_id: "inv_order_1",
  payment_mode: "prepaid",
  pickup_location_name: "warehouse-YP63ZDXB",
  to: { name: "Dharamshala", phone: "7580067026", address_1: "Ram Nagar", city: "Dharamshala", pincode: "176215", state: "HP", country: "IN" },
  weight_grams: 5000,
} as const

describe("Delhivery declared value + contents (the ₹0.00 'Inventory item' label)", () => {
  beforeEach(() => createShipment.mockClear())

  it("sends the value of the goods in the box, not 0", async () => {
    await new DelhiveryProviderAdapter({ api_token: "t" }).createShipment({
      ...base,
      items: [{ name: "40s+60s 6PLY White HandWoven 36in", quantity: 111, unit_price: 135 }],
      sub_total: 14985,
    } as CreateShipmentInput)
    const sent = createShipment.mock.calls[0][0]
    expect(sent.total_amount).toBe(14985)
    expect(sent.product_desc).toBe("40s+60s 6PLY White HandWoven 36in × 111")
  })

  it("declares only what is shipped on a partial, and falls back to sub_total", () => {
    expect(delhiveryDeclaredValue({ items: [{ name: "a", quantity: 10, unit_price: 135 }], sub_total: 14985 } as any)).toBe(1350)
    expect(delhiveryDeclaredValue({ items: [{ name: "a", quantity: 1, unit_price: 0 }], sub_total: 900 } as any)).toBe(900)
    expect(delhiveryDeclaredValue({ items: [{ name: "a", quantity: 1, unit_price: 0 }] } as any)).toBeUndefined()
  })

  it("itemises lines and caps the text", () => {
    expect(delhiveryProductDesc([{ name: "Shirt", quantity: 1, unit_price: 1 }, { name: "Stole", quantity: 3, unit_price: 1 }] as any)).toBe("Shirt, Stole × 3")
    expect(delhiveryProductDesc([{ name: "x".repeat(400), quantity: 1, unit_price: 1 }] as any).length).toBe(250)
  })
})

describe("Delhivery label", () => {
  it("returns the PDF link when the packing slip has one", async () => {
    getLabel.mockResolvedValueOnce({ packages: [{ pdf_download_link: "https://s3/label.pdf" }] })
    const label = await new DelhiveryProviderAdapter({ api_token: "t" }).getLabel({ awb: "41712510000140" } as any)
    expect(getLabel).toHaveBeenCalledWith("41712510000140", { pdf: true })
    expect(label).toMatchObject({ label_url: "https://s3/label.pdf", format: "pdf" })
  })

  it("falls back to the tracking page, and says so", async () => {
    getLabel.mockResolvedValueOnce({ packages: [] })
    const label = await new DelhiveryProviderAdapter({ api_token: "t" }).getLabel({ awb: "1" } as any)
    expect(label).toMatchObject({ format: "tracking_page", label_url: "https://www.delhivery.com/track/package/1" })
  })
})
