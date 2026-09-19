import {
  buildInvoiceRow,
  buildInventoryOrderInvoiceModel,
} from "../inventory-order-invoice-model"

const ISSUED = new Date("2026-09-19T00:00:00.000Z")

const order = {
  id: "inv_order_01M1ZH7Y50W37WMGXYP2DM1KAF",
  currency_code: "inr",
  order_date: "2026-09-08T00:00:00.000Z",
  expected_delivery_date: "2026-10-08T00:00:00.000Z",
}

const build = (lines: any[], charges: any[] = []) =>
  buildInventoryOrderInvoiceModel({
    order,
    lines,
    charges,
    supplier: {
      name: "Ghosh and Organic Fashionary",
      tax_id: "19CZCPG3981P1Z0",
      tax_id_type: "GSTIN",
      country_code: "IN",
    },
    billTo: { name: "Jaal Yantra Textiles", lines: ["Dharamshala", null, "176215"] },
    issuedOn: ISSUED,
  })

describe("buildInvoiceRow", () => {
  it("prints the rate unsummed when a dye job applies, as the mills write it", () => {
    const row = buildInvoiceRow(
      { material_name: "33s Kala Cotton", color: "Red", quantity: 5.7, price: 165, extra_cost: 120 },
      0
    )
    expect(row.rateLabel).toBe("165.00+120.00")
    expect(row.effectiveRate).toBe(285)
    // 5.7 × 285 = 1624.50 — the figure on GOF/2026-27/007 line 1.
    expect(row.amount).toBe(1624.5)
  })

  it("prints a plain rate when there is no dye job", () => {
    const row = buildInvoiceRow({ material_name: "40lea Linen", quantity: 1, price: 645 }, 0)
    expect(row.rateLabel).toBe("645.00")
    expect(row.amount).toBe(645)
  })

  it("folds the colour into the description", () => {
    expect(
      buildInvoiceRow({ material_name: "Matka", color: "Earthy Tone", quantity: 1, price: 1 }, 0)
        .description
    ).toBe("Matka — Earthy Tone")
  })

  // 🔑 The items created through `new_material` are already titled
  // "<name> — <colour>"; appending again reads like a defect.
  it("does not repeat a colour the name already carries", () => {
    expect(
      buildInvoiceRow(
        { material_name: "Matka (H.S+H.W) — Earthy Tone", color: "Earthy Tone", quantity: 1, price: 1 },
        0
      ).description
    ).toBe("Matka (H.S+H.W) — Earthy Tone")
  })

  it("falls back through item title and sku rather than printing nothing", () => {
    expect(buildInvoiceRow({ item_title: "Some Cloth", quantity: 1, price: 1 }, 0).description).toBe(
      "Some Cloth"
    )
    expect(buildInvoiceRow({ sku: "OTH-X-001", quantity: 1, price: 1 }, 0).description).toBe(
      "OTH-X-001"
    )
  })

  it("numbers rows from 1, not 0", () => {
    expect(buildInvoiceRow({ material_name: "x", quantity: 1, price: 1 }, 0).sl).toBe(1)
  })

  it("survives a line with null money without emitting NaN", () => {
    const row = buildInvoiceRow(
      { material_name: "x", quantity: null, price: null, extra_cost: null },
      0
    )
    expect(row.amount).toBe(0)
    expect(Number.isNaN(row.amount)).toBe(false)
  })
})

describe("buildInventoryOrderInvoiceModel — the GOF invoice, reproduced", () => {
  // Every line of GOF/2026-27/007.
  const gofLines = [
    { material_name: "33s Kala Cotton", color: "Red", quantity: 5.7, price: 165, extra_cost: 120 },
    { material_name: "33s Kala Cotton", color: "Greens Light", quantity: 5.6, price: 165, extra_cost: 120 },
    { material_name: "100s Muslin", color: "Orange", quantity: 5.7, price: 255, extra_cost: 120 },
    { material_name: "100s Muslin", color: "Seafoam", quantity: 5.8, price: 255, extra_cost: 120 },
    { material_name: "150s Muslin", color: "Greyish Blue", quantity: 5.7, price: 285, extra_cost: 120 },
    { material_name: "150s Muslin", color: "Earthy Tone", quantity: 5.6, price: 285, extra_cost: 120 },
    { material_name: "60lea Linen", color: "Red", quantity: 5.8, price: 690, extra_cost: 120 },
    { material_name: "60lea Linen", color: "Greens Light", quantity: 5.6, price: 690, extra_cost: 120 },
    { material_name: "40lea Linen", color: "White", quantity: 1, price: 645, extra_cost: 0 },
    { material_name: "Mulberry Silk 3/4", color: "Beige", quantity: 5.8, price: 1155, extra_cost: 120 },
    { material_name: "Mulberry Silk 3/4", color: "Seafoam", quantity: 5.9, price: 1155, extra_cost: 120 },
    { material_name: "Mulberry Silk 3/4", color: "White", quantity: 1.2, price: 1155, extra_cost: 0 },
    { material_name: "Matka", color: "Greyish Blue", quantity: 5.6, price: 1460, extra_cost: 120 },
    { material_name: "Matka", color: "Earthy Tone", quantity: 5.6, price: 1460, extra_cost: 120 },
  ]

  it("adds the 14 lines up to the order's goods total", () => {
    const model = build(gofLines)
    expect(model.rows).toHaveLength(14)
    expect(model.totals.goods).toBe(55988)
  })

  it("raises the grand total by tax and shipping", () => {
    const model = build(gofLines, [
      { type: "tax", amount: 2800 },
      { type: "shipping", amount: 60 },
    ])
    expect(model.totals.grandTotal).toBe(58848)
    expect(model.amountInWords).toBe(
      "Rupees Fifty Eight Thousand Eight Hundred Forty Eight only"
    )
  })

  // 🔴 The sign rule has one home. A discount printed as if it raised the total
  // is how a document comes to disagree with the payable ceiling.
  it("LOWERS the grand total for a discount and an adjustment", () => {
    const model = build(gofLines, [
      { type: "tax", amount: 2800 },
      { type: "discount", amount: 1000 },
      { type: "adjustment", amount: 500 },
    ])
    expect(model.totals.grandTotal).toBe(55988 + 2800 - 1000 - 500)
    const byLabel = Object.fromEntries(model.totals.charges.map((c) => [c.label, c.raises]))
    expect(byLabel).toEqual({ Tax: true, Discount: false, Adjustment: false })
  })

  it("never prints a negative grand total", () => {
    const model = build(gofLines, [{ type: "discount", amount: 999999 }])
    expect(model.totals.grandTotal).toBe(0)
  })

  it("ignores a charge type it does not understand rather than guessing upward", () => {
    const model = build(gofLines, [{ type: "tribute", amount: 5000 } as any])
    expect(model.totals.grandTotal).toBe(55988)
  })

  // 🔴 A `tax` of -200 must not quietly reduce what is owed.
  it("takes a charge's direction from its type, never from a negative amount", () => {
    const model = build(gofLines, [{ type: "tax", amount: -200 }])
    expect(model.totals.grandTotal).toBe(55988 + 200)
  })

  it("titles itself a proforma and says it is not a tax invoice", () => {
    const model = build(gofLines)
    expect(model.title).toBe("PROFORMA INVOICE")
    expect(model.provenanceNote).toMatch(/Not a tax invoice/i)
  })

  it("uses the order id as the reference rather than minting a number", () => {
    expect(build(gofLines).reference).toBe(order.id)
  })

  it("carries the supplier's GSTIN through", () => {
    const model = build(gofLines)
    expect(model.supplier.taxIdLabel).toBe("GSTIN")
    expect(model.supplier.taxId).toBe("19CZCPG3981P1Z0")
  })

  it("drops empty bill-to lines instead of printing blanks", () => {
    expect(build(gofLines).billTo.lines).toEqual(["Dharamshala", "176215"])
  })

  it("formats dates as plain ISO days", () => {
    const model = build(gofLines)
    expect(model.invoiceDate).toBe("2026-09-19")
    expect(model.orderDate).toBe("2026-09-08")
    expect(model.expectedDeliveryDate).toBe("2026-10-08")
  })

  it("leaves a missing or unparseable date null rather than printing Invalid Date", () => {
    const model = buildInventoryOrderInvoiceModel({
      order: { id: "x", order_date: null, expected_delivery_date: "not-a-date" },
      lines: [],
      charges: [],
      supplier: null,
      billTo: {},
      issuedOn: ISSUED,
    })
    expect(model.orderDate).toBeNull()
    expect(model.expectedDeliveryDate).toBeNull()
  })

  it("produces an empty but valid invoice for an order with no lines", () => {
    const model = build([])
    expect(model.rows).toEqual([])
    expect(model.totals.goods).toBe(0)
    expect(model.amountInWords).toBe("Rupees Zero only")
  })
})
