import { DTDC_DESCRIPTION_MAX, dtdcDescription } from "../dtdc-description"
import { resolveShippingProvider } from "../resolver"

const throwingContainer = {
  resolve() {
    throw new Error("module unavailable")
  },
} as any

// The HR Handloom order DTDC refused on 2026-10-13: 18 fabrics, 10 m each.
const EIGHTEEN_FABRICS = Array.from({ length: 18 }, (_, i) => ({
  name: `Kala Cotton Handwoven Fabric — Colour ${i + 1}`,
  sku: `KC-${i + 1}`,
  quantity: 10,
  price: 380,
}))

const input = (over: Record<string, unknown> = {}) =>
  ({
    reference_id: "inv_order_x",
    payment_mode: "prepaid",
    pickup_location_name: "",
    to: { name: "Dharamshala", phone: "1", address_1: "a", city: "c", state: "s", pincode: "176215", country: "IN" },
    items: EIGHTEEN_FABRICS,
    weight_grams: 26000,
    ...over,
  }) as any

describe("dtdcDescription", () => {
  it("keeps a short item list as is", () => {
    expect(dtdcDescription(input({ items: EIGHTEEN_FABRICS.slice(0, 2) }))).toBe(
      "Kala Cotton Handwoven Fabric — Colour 1, Kala Cotton Handwoven Fabric — Colour 2"
    )
  })

  it("fits 18 fabric names under DTDC's limit, keeping whole names and counting the rest", () => {
    const all = EIGHTEEN_FABRICS.map((i) => i.name).join(", ")
    expect(all.length).toBeGreaterThan(DTDC_DESCRIPTION_MAX)

    const d = dtdcDescription(input())
    expect(d.length).toBeLessThanOrEqual(DTDC_DESCRIPTION_MAX)
    expect(d).toMatch(/^Kala Cotton Handwoven Fabric — Colour 1, .*Colour \d+ \+\d+ more$/)
    const shown = d.split(", ").length
    expect(d.endsWith(` +${18 - shown} more`)).toBe(true)
  })

  it("prefers a given description, capped", () => {
    expect(dtdcDescription(input({ product_description: "Fabric" }))).toBe("Fabric")
    expect(dtdcDescription(input({ product_description: "x".repeat(400) }))).toHaveLength(
      DTDC_DESCRIPTION_MAX
    )
  })

  it("cuts a single over-long name rather than sending it whole", () => {
    expect(
      dtdcDescription(input({ items: [{ name: "y".repeat(300), quantity: 1, price: 1 }] }))
    ).toHaveLength(DTDC_DESCRIPTION_MAX)
  })
})

describe("resolveShippingProvider('dtdc') — description sent to DTDC", () => {
  const saved = { code: process.env.DTDC_CUSTOMER_CODE, key: process.env.DTDC_API_KEY }
  beforeAll(() => {
    process.env.DTDC_CUSTOMER_CODE = "TEST"
    process.env.DTDC_API_KEY = "TEST"
  })
  afterAll(() => {
    if (saved.code === undefined) delete process.env.DTDC_CUSTOMER_CODE
    else process.env.DTDC_CUSTOMER_CODE = saved.code
    if (saved.key === undefined) delete process.env.DTDC_API_KEY
    else process.env.DTDC_API_KEY = saved.key
  })

  it("never posts a description of 250+ characters", async () => {
    const provider: any = await resolveShippingProvider(throwingContainer, "dtdc")
    let sent: any
    provider.client.createShipment = async (params: any) => {
      sent = params
      return { data: [{ reference_number: "AWB1" }] }
    }

    await provider.createShipment(input())

    expect(sent.description.length).toBeLessThanOrEqual(DTDC_DESCRIPTION_MAX)
    expect(sent.description).toContain("Kala Cotton Handwoven Fabric — Colour 1")
  })
})
