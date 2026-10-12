import { computeProfitShare } from "../profit-share"

describe("computeProfitShare (#2322)", () => {
  it("founder's worked example: 4 of 10 sold at ₹1,000, 50% → ₹2,000 owed", () => {
    const s = computeProfitShare({
      percent: 50,
      run_quantity: 10,
      sales: [{ quantity: 4, unit_price: 1000, currency_code: "inr" }],
      settlements: [],
    })
    expect(s.gross_sales).toBe(4000)
    expect(s.owed).toBe(2000)
    expect(s.balance).toBe(2000)
    expect(s.unsold_quantity).toBe(6)
    expect(s.status).toBe("open")
  })

  it("partial payment leaves the balance open; full payment settles", () => {
    const sales = [{ quantity: 10, unit_price: 5700, currency_code: "inr" }]
    const part = computeProfitShare({
      percent: 50,
      sales,
      settlements: [{ amount: 10000, currency_code: "inr" }],
    })
    expect(part.owed).toBe(28500)
    expect(part.balance).toBe(18500)
    expect(part.status).toBe("open")

    const full = computeProfitShare({
      percent: 50,
      sales,
      settlements: [
        { amount: 10000, currency_code: "inr" },
        { amount: 18500, currency_code: "inr" },
      ],
    })
    expect(full.balance).toBe(0)
    expect(full.status).toBe("settled")
  })

  it("no agreement is null owed, not 0", () => {
    const s = computeProfitShare({
      percent: null,
      sales: [{ quantity: 1, unit_price: 100, currency_code: "inr" }],
      settlements: [],
    })
    expect(s.owed).toBeNull()
    expect(s.balance).toBeNull()
    expect(s.status).toBe("none")
  })

  it("an agreement with no sales yet owes 0 and says so", () => {
    const s = computeProfitShare({ percent: 50, sales: [], settlements: [] })
    expect(s.owed).toBe(0)
    expect(s.status).toBe("no_sales")
  })

  it("flags mixed currencies", () => {
    const s = computeProfitShare({
      percent: 50,
      sales: [
        { quantity: 1, unit_price: 100, currency_code: "inr" },
        { quantity: 1, unit_price: 10, currency_code: "usd" },
      ],
      settlements: [],
    })
    expect(s.currency_mismatch).toBe(true)
  })
})
