import { composeQuoteAssurance } from "../lib/quote-assurance"

/**
 * The trust block (#1428 follow-up).
 *
 * 🔴 Two assertions carry this file, and both are about NOT saying something.
 *
 * A "verified" badge on an unverified workshop does not just mislead one buyer
 * — it empties the word on every workshop that earned it. And "nothing further
 * to pay" over a non-DDP cross-border order is a false statement about money:
 * duty, import VAT and the carrier's advancement fee run to roughly a third of
 * goods value, and the buyer meets them at the door (#1447).
 */

const PROVENANCE = {
  maker_name: "Unique Pashmina",
  rows: [
    { key: "maker_type", label: "Maker type", value: "Manufacturer" },
    { key: "made_to_order", label: "Production", value: "Made to order" },
    { key: "weaving", label: "Weaving", value: "In house" },
  ],
}

const base = {
  currency_code: "inr",
  money: { subtotal: 1000, freight: 200 },
  tax: { total: 60, inclusive: false, status: "taxable" },
  cross_border: false,
  expires_in_days: 7,
}

const keys = (a: any) => a.points.map((p: any) => p.key)
const charge = (a: any, key: string) =>
  a.charges.find((c: any) => c.key === key)

describe("composeQuoteAssurance", () => {
  it("🔴 does NOT badge a workshop we have not verified", () => {
    const a = composeQuoteAssurance({
      ...base,
      producer: { name: "Unique Pashmina", is_verified: false },
      provenance: PROVENANCE,
    })

    expect(a.verified).toBe(false)
    expect(keys(a)).not.toContain("verified")
  })

  it("badges one we have", () => {
    const a = composeQuoteAssurance({
      ...base,
      producer: { name: "Unique Pashmina", is_verified: true },
      provenance: PROVENANCE,
    })

    expect(a.verified).toBe(true)
    expect(keys(a)).toContain("verified")
  })

  it("🔑 says nothing about craft when there are no facts to say it from", () => {
    // A generic paragraph about artisanship, applied to a maker whose profile
    // is empty, is marketing copy we have invented on their behalf.
    const a = composeQuoteAssurance({
      ...base,
      producer: { name: "Unique Pashmina", is_verified: false },
      provenance: { maker_name: "Unique Pashmina", rows: [] },
    })

    expect(keys(a)).not.toContain("artisanal")
    expect(keys(a)).toContain("direct")
  })

  it("🔴 refuses 'nothing further to pay' on a non-DDP cross-border order", () => {
    const a = composeQuoteAssurance({
      ...base,
      cross_border: true,
      duty: { prepaid: false },
      producer: { name: "Unique Pashmina", is_verified: true },
      provenance: PROVENANCE,
    })

    expect(a.no_further_charges).toBe(false)
    const duty = charge(a, "duty")
    expect(duty.included).toBe(false)
    expect(duty.note).toContain("Payable by you on arrival")
  })

  it("says it plainly when duty IS prepaid", () => {
    const a = composeQuoteAssurance({
      ...base,
      cross_border: true,
      duty: { prepaid: true, total: 100, import_tax: 250, carrier_fee: 40 },
      producer: { name: "Unique Pashmina", is_verified: true },
      provenance: PROVENANCE,
    })

    expect(a.no_further_charges).toBe(true)
    // All three, not just the duty — the duty alone funds about a quarter of
    // a real EU undertaking, and quoting it as the whole is how the gap lands
    // on margin (#1447).
    expect(charge(a, "duty").amount).toBe(390)
    expect(charge(a, "duty").included).toBe(true)
  })

  it("never mentions import duty on a domestic lane", () => {
    // Telling a Mumbai buyer on an Indian lane that duty is payable on arrival
    // is both false and alarming.
    const a = composeQuoteAssurance({
      ...base,
      cross_border: false,
      producer: { name: "Unique Pashmina", is_verified: true },
      provenance: PROVENANCE,
    })

    expect(charge(a, "duty")).toBeUndefined()
    expect(a.no_further_charges).toBe(true)
  })

  it("🔴 never states the partner's commission", () => {
    // `commission_bps` is the arrangement between the platform and the maker.
    // Publishing it to the maker's own customer hands them the maker's net.
    const a = composeQuoteAssurance({
      ...base,
      producer: { name: "Unique Pashmina", is_verified: true },
      provenance: PROVENANCE,
    })

    const serialised = JSON.stringify(a).toLowerCase()
    expect(serialised).not.toContain("commission")
    expect(serialised).not.toContain("bps")
    // What it says instead: the buyer pays no platform fee.
    expect(charge(a, "platform").note).toContain("we are paid by them, not by you")
  })

  it("states an unresolved tax as unresolved rather than as zero", () => {
    const a = composeQuoteAssurance({
      ...base,
      tax: { total: null, status: "unknown" },
      producer: { name: "P", is_verified: false },
      provenance: PROVENANCE,
    })

    const tax = charge(a, "tax")
    expect(tax.amount).toBeNull()
    expect(tax.included).toBe(false)
  })
})
