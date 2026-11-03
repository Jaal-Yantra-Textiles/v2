import { ownershipByHolder } from "../cap-table-ownership"

const founderA = { id: "inv_a", name: "Founder A" }
const founderB = { id: "inv_b", name: "Founder B" }

describe("ownershipByHolder", () => {
  it("sums a holder's several stakes into one slice (founding shares + a loan conversion)", () => {
    const rows = ownershipByHolder([
      { investor_id: "inv_a", investor: founderA, number_of_shares: 1000, total_invested: 10000, status: "fully_paid" },
      { investor_id: "inv_a", investor: founderA, number_of_shares: 8000, total_invested: 80000, status: "fully_paid" },
      { investor_id: "inv_b", investor: founderB, number_of_shares: 1000, total_invested: 10000, status: "fully_paid" },
      // Retired rows never count.
      { investor_id: "inv_a", investor: founderA, number_of_shares: 500, status: "rejected" },
      { investor_id: "inv_b", investor: founderB, number_of_shares: 50, status: "rejected" },
      { investor_id: "inv_c", investor: { id: "inv_c", name: "Prospect" }, number_of_shares: 700, status: "not_followed_up" },
    ])

    expect(rows).toEqual([
      { key: "inv_a", label: "Founder A", value: 9000 },
      { key: "inv_b", label: "Founder B", value: 1000 },
    ])
    const total = rows.reduce((t, r) => t + r.value, 0)
    expect(Math.round((rows[0].value / total) * 1000) / 10).toBe(90)
  })

  it("weighs by shares, not money — a premium round does not inflate ownership", () => {
    const rows = ownershipByHolder([
      { investor_id: "a", investor: { name: "Founder" }, number_of_shares: 9000, total_invested: 90000, status: "fully_paid" },
      { investor_id: "b", investor: { name: "Angel" }, number_of_shares: 1000, total_invested: 500000, status: "fully_paid" },
    ])
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Founder", 9000],
      ["Angel", 1000],
    ])
  })

  it("falls back to the amount invested when a stake has no share count", () => {
    const rows = ownershipByHolder([
      { investor_id: "a", investor: { name: "SAFE holder" }, number_of_shares: 0, total_invested: 25000, status: "fully_paid" },
    ])
    expect(rows).toEqual([{ key: "a", label: "SAFE holder", value: 25000 }])
  })
})
