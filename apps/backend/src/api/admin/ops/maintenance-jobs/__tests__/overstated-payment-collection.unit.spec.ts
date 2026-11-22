import { findOverstatedCollections } from "../lib/overstated-payment-collection"

const pay = (captured: number[], refunded: number[] = []) => ({
  captures: captured.map((amount) => ({ amount })),
  refunds: refunded.map((amount) => ({ amount })),
})

// Order #101 on prod, 2026-11-22 (#2583).
const order101 = () => ({
  order_total: 441.79,
  collections: [
    { id: "deposit", status: "completed", amount: 94.43, payments: [pay([94.43])] },
    { id: "grown", status: "partially_captured", amount: 347.36, payments: [pay([220.34])] },
    { id: "rest", status: "completed", amount: 127.02, payments: [pay([127.02])] },
  ],
})

describe("findOverstatedCollections (#2583)", () => {
  it("settles the grown collection on order #101 to what it captured", () => {
    const { verdicts, skipped_reason } = findOverstatedCollections(order101())
    expect(skipped_reason).toBeNull()
    expect(verdicts).toEqual([
      expect.objectContaining({ collection_id: "grown", amount: 347.36, captured: 220.34 }),
    ])
  })

  it("never touches a part-captured collection while the order still owes money", () => {
    const input = order101()
    input.collections = input.collections.filter((c) => c.id !== "rest")
    const { verdicts, skipped_reason } = findOverstatedCollections(input)
    expect(verdicts).toEqual([])
    expect(skipped_reason).toMatch(/still owes 127\.02/)
  })

  it("counts refunds against what was captured", () => {
    const input = order101()
    input.collections[2].payments = [pay([127.02], [127.02])]
    expect(findOverstatedCollections(input).verdicts).toEqual([])
  })

  it("ignores a cancelled collection's captures and leaves completed ones alone", () => {
    const input = order101()
    input.collections[2].status = "canceled"
    expect(findOverstatedCollections(input).verdicts).toEqual([])
  })

  it("leaves an uncaptured (abandoned) request alone even on a paid order", () => {
    const input = order101()
    input.collections.push({ id: "abandoned", status: "awaiting", amount: 50, payments: [] })
    expect(findOverstatedCollections(input).verdicts.map((v) => v.collection_id)).toEqual(["grown"])
  })

  it("compares in cents, so float noise does not decide", () => {
    const input = {
      order_total: 0.3,
      collections: [
        { id: "a", status: "partially_captured", amount: 0.3, payments: [pay([0.1])] },
        { id: "b", status: "completed", amount: 0.2, payments: [pay([0.2])] },
      ],
    }
    expect(findOverstatedCollections(input).verdicts).toEqual([
      expect.objectContaining({ collection_id: "a", captured: 0.1 }),
    ])
  })
})
