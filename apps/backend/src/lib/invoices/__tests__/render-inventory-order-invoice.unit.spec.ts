import { buildInventoryOrderInvoiceModel } from "../inventory-order-invoice-model"
import { renderInventoryOrderInvoicePdf } from "../render-inventory-order-invoice"

const model = (overrides: Partial<Parameters<typeof buildInventoryOrderInvoiceModel>[0]> = {}) =>
  buildInventoryOrderInvoiceModel({
    order: {
      id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF",
      currency_code: "inr",
      order_date: "2026-09-08T00:00:00.000Z",
      expected_delivery_date: "2026-10-08T00:00:00.000Z",
    },
    lines: [
      {
        // 🔑 The em dash is the point: pdf-lib's WinAnsi encoder throws on it,
        // and every item created through `new_material` has one in its title.
        material_name: "Matka (H.S+H.W) — Earthy Tone",
        hs_code: "5007",
        unit_of_measure: "Meter",
        quantity: 5.6,
        price: 1460,
        extra_cost: 120,
      },
    ],
    charges: [{ type: "tax", amount: 2800 }],
    supplier: { name: "Ghosh and Organic Fashionary", tax_id: "19CZCPG3981P1Z0", tax_id_type: "GSTIN" },
    billTo: { name: "Ksaman Naturals Pvt Ltd", lines: ["Dharamshala", "IN 176215"] },
    issuedOn: new Date("2026-09-19T00:00:00.000Z"),
    ...(overrides as any),
  })

describe("renderInventoryOrderInvoicePdf", () => {
  it("produces a real PDF", async () => {
    const bytes = await renderInventoryOrderInvoicePdf(model())
    expect(bytes.byteLength).toBeGreaterThan(1000)
    // %PDF- magic
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-")
  })

  /**
   * 🔴 The regression this file exists for. An unmapped glyph makes pdf-lib
   * throw and takes the WHOLE document with it, so a fabric name containing an
   * em dash — which is most of them — would 500 the invoice route.
   */
  it("does not throw on characters outside WinAnsi", async () => {
    await expect(
      renderInventoryOrderInvoicePdf(
        model({
          lines: [
            { material_name: "Matka — Earthy Tone ₹ “quoted” ’", quantity: 1, price: 1 },
            { material_name: "हिंदी नाम", quantity: 1, price: 1 },
          ],
        } as any)
      )
    ).resolves.toBeDefined()
  })

  it("renders an order with no lines rather than failing", async () => {
    const bytes = await renderInventoryOrderInvoicePdf(model({ lines: [] } as any))
    expect(bytes.byteLength).toBeGreaterThan(500)
  })

  /**
   * The table head is redrawn per page; a long order must not run off the
   * bottom.
   *
   * ⚠️ `> 1` is NOT the assertion to make here, and this test said so for one
   * revision. The totals block starts a page of its own when it runs out of
   * room, so 80 rows reach a second page whether or not the ROW loop paginates
   * — the test passed with row pagination deleted. 80 rows need THREE pages
   * when the rows wrap and only two when they spill off the first, so three is
   * the number that can tell the two apart.
   */
  it("paginates a long order — and the rows are what wrap, not just the totals", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      material_name: `Cloth ${i}`,
      quantity: 1,
      price: 100,
      extra_cost: 20,
    }))
    const bytes = await renderInventoryOrderInvoicePdf(model({ lines: many } as any))
    // Read the page count off the parsed document, not a regex over the bytes —
    // a regex that matches nothing looks exactly like a single-page result.
    const { PDFDocument } = await import("pdf-lib")
    const parsed = await PDFDocument.load(bytes)
    expect(parsed.getPageCount()).toBeGreaterThanOrEqual(3)
  })

  it("keeps a normal-sized order on one page", async () => {
    const lines = Array.from({ length: 14 }, (_, i) => ({
      material_name: `Cloth ${i}`,
      quantity: 1,
      price: 100,
      extra_cost: 20,
    }))
    const bytes = await renderInventoryOrderInvoicePdf(model({ lines } as any))
    const { PDFDocument } = await import("pdf-lib")
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })
})
