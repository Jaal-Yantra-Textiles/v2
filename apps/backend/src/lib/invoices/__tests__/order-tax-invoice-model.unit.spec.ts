import {
  buildOrderTaxInvoiceModel,
  financialYearOf,
  formatInvoiceNumber,
  resolveSupplyType,
  type OrderTaxInvoiceInput,
  type TaxInvoiceParty,
} from "../order-tax-invoice-model"

const SELLER: TaxInvoiceParty = {
  name: "Jaal Yantra Textiles",
  lines: ["Dharamshala", "Himachal Pradesh 176215", "India"],
  state: "Himachal Pradesh",
  postal_code: "176215",
  country_code: "in",
}

// Prod order #148 (2026-10-27): 2 aprons, 5% GST, tax-exclusive design-order
// price, in-person pickup with no address.
const input = (over: Partial<OrderTaxInvoiceInput> = {}): OrderTaxInvoiceInput => ({
  invoice_number: "JYT/2026-27/0001",
  invoice_date: "2026-11-09",
  order: {
    id: "order_148",
    display_id: 148,
    created_at: "2026-10-27T11:51:49.622Z",
    currency_code: "inr",
    total: 2399.9955,
    paid_total: 2400,
  },
  seller: { legal_name: "Jaal Yantra Textiles", gstin: "02ABCDE1234F1Z5", address: SELLER },
  bill_to: null,
  ship_to: null,
  lines: [
    {
      title: "Apron — Cherry",
      variant_title: "Black 8-ply Cotton",
      hs_code: "6211",
      quantity: 2,
      total: 2399.9955,
      tax_total: 114.2855,
      tax_rate: 5,
    },
  ],
  charges: [{ name: "In Person Pickup", total: 0, tax_total: 0, tax_rate: 5 }],
  ...over,
})

describe("buildOrderTaxInvoiceModel", () => {
  it("prints order #148 to the paisa, CGST+SGST for a pickup", () => {
    const m = buildOrderTaxInvoiceModel(input())

    expect(m.supply_type).toBe("intra_state")
    expect(m.rows).toHaveLength(1) // the free pickup prints no row
    expect(m.rows[0]).toMatchObject({
      description: "Apron — Cherry - Black 8-ply Cotton",
      hsn: "6211",
      quantity: 2,
      unit_rate: 1142.86,
      taxable: 2285.71,
      tax_rate: 5,
    })
    expect(m.rows[0].cgst + m.rows[0].sgst).toBeCloseTo(114.29, 2)
    expect(m.rows[0].igst).toBe(0)
    expect(m.totals).toMatchObject({
      taxable: 2285.71,
      tax: 114.29,
      round_off: 0,
      grand_total: 2400,
      paid: 2400,
      balance_due: 0,
    })
    expect(m.amount_in_words).toBe("Rupees Two Thousand Four Hundred only")
  })

  it("charges IGST to another state", () => {
    const m = buildOrderTaxInvoiceModel(
      input({
        ship_to: {
          name: "Buyer",
          lines: [],
          state: "Gujarat",
          postal_code: "380001",
          country_code: "in",
        },
      })
    )

    expect(m.supply_type).toBe("inter_state")
    expect(m.place_of_supply).toBe("Gujarat (24)")
    expect(m.totals.igst).toBe(114.29)
    expect(m.totals.cgst + m.totals.sgst).toBe(0)
  })

  it("splits an odd paisa so CGST and SGST still sum to the tax", () => {
    const m = buildOrderTaxInvoiceModel(
      input({
        order: { ...input().order, total: 105.01 },
        lines: [{ title: "Scarf", quantity: 1, total: 105.01, tax_total: 5.01, tax_rate: 5 }],
        charges: [],
      })
    )

    expect(m.rows[0].cgst + m.rows[0].sgst).toBeCloseTo(5.01, 2)
    expect(Math.abs(m.rows[0].cgst - m.rows[0].sgst)).toBeLessThanOrEqual(0.01)
  })

  it("adds a taxed shipping charge as its own row", () => {
    const m = buildOrderTaxInvoiceModel(
      input({
        order: { ...input().order, total: 2504.9955 },
        charges: [{ name: "Standard Shipping", total: 105, tax_total: 5, tax_rate: 5 }],
      })
    )

    expect(m.rows.map((r) => r.description)).toEqual([
      "Apron — Cherry - Black 8-ply Cotton",
      "Standard Shipping",
    ])
    expect(m.totals.grand_total).toBe(2505)
    // Shipping is a service: its blank HSN is not "missing".
    expect(m.notes.join(" ")).not.toContain("HSN")
  })

  it("marks an export under LUT", () => {
    const m = buildOrderTaxInvoiceModel(
      input({
        order: { ...input().order, currency_code: "aud", total: 441.79, paid_total: 0 },
        ship_to: { name: "Buyer", lines: [], state: "Nsw", country_code: "au" },
        lines: [{ title: "Shawl", quantity: 1, total: 441.79, tax_total: 0, tax_rate: 0 }],
        charges: [],
        export_lut_arn: "AD0204260012345",
      })
    )

    expect(m.supply_type).toBe("export")
    expect(m.totals.balance_due).toBe(441.79)
    expect(m.notes.join(" ")).toContain("AD0204260012345")
  })

  it("refuses when lines do not add up to the order total", () => {
    expect(() =>
      buildOrderTaxInvoiceModel(input({ order: { ...input().order, total: 3000 } }))
    ).toThrow("order total is 3000")
  })

  it("notes a missing HSN", () => {
    const m = buildOrderTaxInvoiceModel(
      input({ lines: [{ ...input().lines[0], hs_code: null }] })
    )

    expect(m.rows[0].hsn).toBe("")
    expect(m.notes.join(" ")).toContain("HSN not recorded")
  })
})

describe("resolveSupplyType", () => {
  const HP_SELLER = { gstin: "02ABCDE1234F1Z5", address: SELLER }
  // Our real registration: GSTIN 07 (Delhi), goods leave Dharamshala (HP).
  const DELHI_SELLER = {
    gstin: "07AAGCJ0494A1ZV",
    address: { name: "JYT", lines: ["New Delhi"], state: "Delhi", postal_code: "110001", country_code: "in" },
  }
  const DHARAMSHALA: TaxInvoiceParty = SELLER

  it("takes the seller's state from the GSTIN, not the warehouse", () => {
    // Cherry's pickup at Dharamshala, billed under the Delhi GSTIN: inter-state.
    const r = resolveSupplyType(DELHI_SELLER, null, null, DHARAMSHALA)
    expect(r.supply_type).toBe("inter_state")
    expect(r.place_of_supply).toBe("Himachal Pradesh (02) - handed over at dispatch")
  })

  it("is intra-state when the buyer is in the GSTIN's state", () => {
    const delhiBuyer = { name: "x", lines: ["1 CP"], state: "New Delhi", postal_code: "110001", country_code: "in" }
    expect(resolveSupplyType(DELHI_SELLER, delhiBuyer, null, DHARAMSHALA).supply_type).toBe("intra_state")
  })

  it("reads state abbreviations", () => {
    const mh = { name: "x", lines: ["9 Marine Drive"], state: "MH", postal_code: "400001", country_code: "in" }
    const r = resolveSupplyType(HP_SELLER, mh, null)
    expect(r).toEqual({ supply_type: "inter_state", place_of_supply: "Maharashtra (27)" })
  })

  it("refuses a buyer address whose state it cannot read", () => {
    const bad = { name: "x", lines: ["12 Road"], state: "Somewhere", postal_code: "560001", country_code: "in" }
    expect(() => resolveSupplyType(HP_SELLER, bad, null)).toThrow("Cannot read the buyer's state")
  })

  it("falls back to the seller's state with no buyer address and no dispatch", () => {
    const r = resolveSupplyType(HP_SELLER, null, null)
    expect(r.supply_type).toBe("intra_state")
    expect(r.place_of_supply).toContain("Himachal Pradesh")
  })
})

describe("numbering", () => {
  it("rolls the financial year on 1 April IST", () => {
    expect(financialYearOf(new Date("2026-03-31T18:00:00Z"))).toBe("2025-26")
    // 18:30 UTC on 31 March is 00:00 IST on 1 April.
    expect(financialYearOf(new Date("2026-03-31T18:30:00Z"))).toBe("2026-27")
    expect(financialYearOf(new Date("2026-11-09T10:00:00Z"))).toBe("2026-27")
  })

  it("formats a 16-character GST number", () => {
    const n = formatInvoiceNumber("2026-27", 1)
    expect(n).toBe("JYT/2026-27/0001")
    expect(n.length).toBeLessThanOrEqual(16)
  })
})
