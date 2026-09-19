import { decideCountry } from "../set-design-order-country-job"

/**
 * Every branch here is a refusal that protects a real buyer, and the
 * interesting ones — a country the region does not serve, a cart already
 * carrying one — are awkward to reproduce against a live database.
 */

const EUROPE = ["al", "se", "de", "fr", "it"]
const OPEN = { completed_at: null, metadata: {}, shipping_address: null }

describe("decideCountry", () => {
  it("allows a country the region serves", () => {
    expect(
      decideCountry({ cart: OPEN, country: "se", regionCountries: EUROPE })
    ).toEqual({ ok: true })
  })

  /**
   * 🔴 The one that matters. Setting a country the region does not serve leaves
   * the storefront re-regioning exactly as before while the job reports
   * success — a repair that reads as done and changed nothing observable.
   */
  it("REFUSES a country the region does not serve, and says what it does serve", () => {
    const got = decideCountry({
      cart: OPEN,
      country: "us",
      regionCountries: EUROPE,
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("not_in_region")
    expect(got.message).toContain("al, se, de, fr, it")
  })

  it("refuses when the region serves nothing at all", () => {
    const got = decideCountry({ cart: OPEN, country: "se", regionCountries: [] })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("not_in_region")
  })

  it("refuses a COMPLETED cart — it is an order's paper trail", () => {
    const got = decideCountry({
      cart: { ...OPEN, completed_at: "2026-09-18T00:00:00Z" },
      country: "se",
      regionCountries: EUROPE,
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("completed")
  })

  it("refuses a CANCELLED cart — nobody should be sent to a withdrawn order", () => {
    const got = decideCountry({
      cart: { ...OPEN, metadata: { cancelled_at: "2026-09-19T23:02:02Z" } },
      country: "se",
      regionCountries: EUROPE,
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("cancelled")
  })

  it("does not treat an empty cancelled_at stamp as cancelled", () => {
    expect(
      decideCountry({
        cart: { ...OPEN, metadata: { cancelled_at: "   " } },
        country: "se",
        regionCountries: EUROPE,
      })
    ).toEqual({ ok: true })
  })

  it("is a no-op when the cart already names that country", () => {
    const got = decideCountry({
      cart: { ...OPEN, shipping_address: { country_code: "se" } },
      country: "se",
      regionCountries: EUROPE,
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("already_set")
  })

  it("allows CHANGING a country that was set wrongly", () => {
    // The Albania case: a cart that somehow acquired the wrong country must be
    // correctable, not frozen by the already-set check.
    expect(
      decideCountry({
        cart: { ...OPEN, shipping_address: { country_code: "al" } },
        country: "se",
        regionCountries: EUROPE,
      })
    ).toEqual({ ok: true })
  })

  it("compares case-insensitively on both sides", () => {
    expect(
      decideCountry({
        cart: { ...OPEN, shipping_address: { country_code: "SE" } },
        country: "se",
        regionCountries: ["SE", "DE"],
      })
    ).toMatchObject({ reason: "already_set" })
  })

  it("checks completion BEFORE the region, so a finished order never depends on region data", () => {
    const got = decideCountry({
      cart: { ...OPEN, completed_at: "2026-09-18T00:00:00Z" },
      country: "us",
      regionCountries: [],
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("completed")
  })

  it("survives a missing cart and a region list of junk", () => {
    expect(
      decideCountry({ cart: null, country: "se", regionCountries: EUROPE })
    ).toEqual({ ok: true })
    const got = decideCountry({
      cart: OPEN,
      country: "se",
      regionCountries: [null as any, "", "  ", "se"],
    })
    expect(got).toEqual({ ok: true })
  })
})
