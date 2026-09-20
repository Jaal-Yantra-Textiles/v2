import { reachableCustomers } from "../absence"

/**
 * 🔴 Every customer email about a design resolves its recipient through the
 * design↔customer link and returns SILENTLY when there is none. So the graph's
 * customer node is the only place the absence is ever stated — and a node drawn
 * off LINK ROWS rather than reachable records would state it wrongly.
 *
 * Measured on prod 2026-09-20: five Oshen designs, minted into published
 * products and viewed by the client, reached nobody.
 */
describe("reachableCustomers", () => {
  it("keeps a customer who can actually be emailed", () => {
    expect(
      reachableCustomers([{ id: "cus_1", email: "oshenbermagui@gmail.com" }])
    ).toHaveLength(1)
  })

  it("🔴 drops a link row with nothing on the other end", () => {
    /*
     * THE CASE THIS EXISTS FOR. Counting these would draw "Customers: 1" over a
     * design that reaches nobody — answering the question wrongly rather than
     * leaving it open, on the one surface built to show what is missing.
     */
    expect(reachableCustomers([null, undefined, {}, { id: null }])).toEqual([])
  })

  it("🔴 drops a customer with no email — the link feeds an email and nothing else", () => {
    expect(reachableCustomers([{ id: "cus_1", email: null }])).toEqual([])
    expect(reachableCustomers([{ id: "cus_1", email: "   " }])).toEqual([])
  })

  it("keeps the reachable ones out of a mixed list", () => {
    expect(
      reachableCustomers([
        { id: "cus_1", email: "a@b.com" },
        { id: null, email: "ghost@b.com" },
        { id: "cus_2", email: "" },
        { id: "cus_3", email: "c@d.com" },
      ]).map((c) => c.id)
    ).toEqual(["cus_1", "cus_3"])
  })
})
