import { decideOrderCountry } from "../set-order-country-job"

/**
 * The order route refuses every country change, so this job is the only door —
 * which makes each refusal here the only thing between a shipment and a record
 * that disagrees with it.
 */

const PLACED = {
  status: "pending",
  canceled_at: null,
  shipping_address: { id: "ordaddr_1", country_code: "in" },
}

describe("decideOrderCountry", () => {
  it("allows a placed, unfulfilled order", () => {
    expect(
      decideOrderCountry({ order: PLACED, liveFulfillments: 0, country: "se" })
    ).toEqual({ ok: true })
  })

  it("REFUSES an order with a live fulfillment — its label names the old country", () => {
    const got = decideOrderCountry({
      order: PLACED,
      liveFulfillments: 1,
      country: "se",
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("fulfilled")
  })

  it("refuses a cancelled order, by status or by canceled_at", () => {
    for (const order of [
      { ...PLACED, status: "canceled" },
      { ...PLACED, canceled_at: "2026-10-01T00:00:00Z" },
    ]) {
      const got = decideOrderCountry({ order, liveFulfillments: 0, country: "se" })
      expect(got.ok).toBe(false)
      if (got.ok) continue
      expect(got.reason).toBe("cancelled")
    }
  })

  it("refuses an order with no shipping address row", () => {
    const got = decideOrderCountry({
      order: { ...PLACED, shipping_address: null },
      liveFulfillments: 0,
      country: "se",
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("no_address")
  })

  it("is a no-op when the order already ships there, case-insensitively", () => {
    const got = decideOrderCountry({
      order: { ...PLACED, shipping_address: { id: "a", country_code: "SE" } },
      liveFulfillments: 0,
      country: "se",
    })
    expect(got.ok).toBe(false)
    if (got.ok) return
    expect(got.reason).toBe("already_set")
  })
})
