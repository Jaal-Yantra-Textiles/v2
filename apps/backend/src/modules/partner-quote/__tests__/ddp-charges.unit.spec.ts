import {
  computeDdpCharges,
  describeDdpBasis,
  hasConflictingDdpInput,
} from "../lib/ddp-charges"

/**
 * Pinned to DHL Express's own landed-cost planner, 2026-08-22 — a 70,000 INR
 * consignment of 10 units to the Netherlands, transport 6,792:
 *
 *   customs duty       8% × 76,792  =  6,143.36
 *   import VAT        21% × 82,935  = 17,416.43
 *   duty-tax-paid fee                =  1,981.57
 *
 * 🔴 The two failure modes this file exists to catch are both silent and both
 * land on our margin: applying the VAT rate to the goods alone (under by ~1,290
 * here), and funding the duty while forgetting the tax (under by 17,416).
 */
describe("computeDdpCharges — the DHL worked example", () => {
  const example = computeDdpCharges({
    subtotal: 70_000,
    freight: 6_792,
    duty_rate_percent: 8,
    import_tax_rate_percent: 21,
    ddp_fee_total: 1_981.57,
  })

  it("assesses duty on goods PLUS freight", () => {
    expect(example.dutiable_value).toBe(76_792)
    expect(example.duty).toBe(6_143.36)
  })

  it("🔴 cascades — import tax is charged on a value that includes the duty", () => {
    expect(example.import_tax).toBe(17_416.43)
    // Assessed on the goods alone it would be 14,700; on goods + freight but
    // without the duty, 16,126.32. Both are wrong in the same direction.
    expect(example.import_tax).toBeGreaterThan(16_126.32)
  })

  it("sums to what DHL quoted as the DDP part of the landed cost", () => {
    expect(example.carrier_fee).toBe(1_981.57)
    expect(example.total).toBe(25_541.36)
    // Goods + freight + the undertaking = DHL's total, give or take the
    // surcharges that sit outside our freight figure.
    expect(example.total + 76_792).toBeCloseTo(102_333.36, 2)
  })

  it("keeps the rates, so the figure can be re-derived rather than believed", () => {
    expect(example.duty_rate_percent).toBe(8)
    expect(example.import_tax_rate_percent).toBe(21)
  })
})

describe("computeDdpCharges — the other forms", () => {
  it("takes flat amounts where a rate cannot express the tariff line", () => {
    // A specific duty is charged per kilo or per item; no percentage says it.
    const charges = computeDdpCharges({
      subtotal: 70_000,
      freight: 6_792,
      duty_total: 4_500,
      import_tax_total: 12_000,
    })

    expect(charges.duty).toBe(4_500)
    expect(charges.import_tax).toBe(12_000)
    expect(charges.duty_rate_percent).toBeNull()
    expect(charges.total).toBe(16_500)
  })

  it("returns zeros for a charge nobody described", () => {
    // Deliberately not an error here: only the validator knows whether "no
    // answer" means a duty-free lane or a half-filled form.
    const charges = computeDdpCharges({ subtotal: 70_000, freight: 6_792 })

    expect(charges.duty).toBe(0)
    expect(charges.import_tax).toBe(0)
    expect(charges.total).toBe(0)
  })

  it("treats a nil RATE as the real answer it is", () => {
    // AI-ECTA: Indian textiles enter Australia duty-free, and a 0% duty still
    // leaves a GST to compute on the CIF value.
    const charges = computeDdpCharges({
      subtotal: 70_000,
      freight: 6_792,
      duty_rate_percent: 0,
      import_tax_rate_percent: 10,
    })

    expect(charges.duty).toBe(0)
    expect(charges.import_tax).toBe(7_679.2)
    expect(charges.duty_rate_percent).toBe(0)
  })

  it("flags a rate and an amount given for the same charge", () => {
    expect(
      hasConflictingDdpInput({
        subtotal: 1,
        freight: 0,
        duty_rate_percent: 8,
        duty_total: 500,
      })
    ).toBe(true)
    expect(
      hasConflictingDdpInput({
        subtotal: 1,
        freight: 0,
        duty_rate_percent: 8,
        import_tax_total: 500,
      })
    ).toBe(false)
  })

  it("writes down what was applied to what", () => {
    const description = describeDdpBasis(
      computeDdpCharges({
        subtotal: 70_000,
        freight: 6_792,
        duty_rate_percent: 8,
        import_tax_rate_percent: 21,
        ddp_fee_total: 1_981.57,
      })
    )

    expect(description).toContain("duty 8% of goods + freight")
    expect(description).toContain("import tax 21% of goods + freight + duty")
    expect(description).toContain("carrier duty-tax-paid fee")
  })
})
