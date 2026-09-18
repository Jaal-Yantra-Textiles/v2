import {
  describeReceiptConflicts,
  receiptConflicts,
  type ProposedLine,
} from "../lib/order-changes"

/**
 * A proposal must not contradict goods that have already ARRIVED.
 *
 * Staging is locked to `Pending`/`Processing`, but approval is deliberately
 * post-ship, and `updateInventoryOrderWorkflow` carries no status lock of its
 * own. So a change staged while an order was `Processing` can be approved once
 * it is `Delivered` — and since #2118 that is not hypothetical: receipts are
 * recorded as `line_fulfillments`, and a real receipt ran on prod the day that
 * shipped (2 Mill Spun Pashminas onto the books at a partner's bench).
 *
 * 🔴 The rule is deliberately NARROW, and the first test is the reason why. I
 * first believed raising a received line would let the same goods be received
 * twice. It does not: outstanding is `max(0, ordered − received)` and the
 * receipt planner refuses a claim above it, so raising opens capacity for NEW
 * units only. Guarding against it would have blocked a legitimate workflow to
 * prevent nothing.
 */
describe("receiptConflicts", () => {
  const line = (over: Partial<ProposedLine> & { id: string }): ProposedLine => ({
    quantity: 5,
    price: 100,
    ...over,
  })

  it("🔴 ALLOWS raising a received line — it opens capacity for new units, it does not re-open the old ones", () => {
    expect(
      receiptConflicts([line({ id: "l1", quantity: 5 })], { l1: 2 })
    ).toEqual([])
  })

  it("allows lowering to exactly what arrived — an ordinary short-close", () => {
    expect(
      receiptConflicts([line({ id: "l1", quantity: 2 })], { l1: 2 })
    ).toEqual([])
  })

  it("🔴 refuses lowering BELOW what arrived — the books would say we received more than we ordered", () => {
    const [c] = receiptConflicts([line({ id: "l1", quantity: 1 })], { l1: 2 })
    expect(c).toEqual({
      line_id: "l1",
      received: 2,
      reason: "below_received",
      proposed_quantity: 1,
    })
  })

  it("🔴 refuses REMOVING a line that has receipts — the stock would belong to no line", () => {
    const [c] = receiptConflicts([line({ id: "l1", remove: true })], { l1: 2 })
    expect(c).toMatchObject({ line_id: "l1", received: 2, reason: "removed" })
  })

  it("allows removing a line nothing has arrived against", () => {
    expect(receiptConflicts([line({ id: "l1", remove: true })], { l1: 0 })).toEqual([])
    expect(receiptConflicts([line({ id: "l1", remove: true })], {})).toEqual([])
  })

  it("ignores a line whose quantity is not being changed", () => {
    // An omitted quantity leaves the line as it is, so it cannot contradict a
    // receipt — only a STATED quantity can.
    expect(
      receiptConflicts([{ id: "l1", price: 50 } as ProposedLine], { l1: 2 })
    ).toEqual([])
  })

  it("🔴 treats quantity 0 as a stated reduction, not as 'unchanged'", () => {
    // `0` is a value somebody wrote. Reading it as absent would let a line be
    // zeroed out past its receipts.
    const [c] = receiptConflicts([line({ id: "l1", quantity: 0 })], { l1: 2 })
    expect(c.reason).toBe("below_received")
  })

  it("reports every conflicting line, not just the first", () => {
    const conflicts = receiptConflicts(
      [line({ id: "l1", quantity: 0 }), line({ id: "l2", remove: true }), line({ id: "l3" })],
      { l1: 2, l2: 3, l3: 1 }
    )
    expect(conflicts.map((c) => c.line_id)).toEqual(["l1", "l2"])
  })

  it("is inert on an empty or missing proposal", () => {
    expect(receiptConflicts([], { l1: 2 })).toEqual([])
    expect(receiptConflicts(null, { l1: 2 })).toEqual([])
    expect(receiptConflicts(undefined, {})).toEqual([])
  })

  it("skips a malformed line rather than throwing mid-approval", () => {
    expect(
      receiptConflicts([{ quantity: 1 } as any, null as any], { l1: 2 })
    ).toEqual([])
  })

  it("tolerates a non-numeric received value instead of treating it as a conflict", () => {
    expect(
      receiptConflicts([line({ id: "l1", quantity: 1 })], { l1: NaN as any })
    ).toEqual([])
  })
})

describe("describeReceiptConflicts", () => {
  /**
   * An operator reads this while deciding whether to approve. It has to say
   * which line, how much arrived, and what was asked — an id alone is useless
   * on a screen full of ids.
   */
  it("names the line, the received amount and the proposed one", () => {
    const msg = describeReceiptConflicts(
      receiptConflicts([{ id: "l1", quantity: 1 }], { l1: 2 })
    )
    expect(msg).toContain("l1")
    expect(msg).toContain("2")
    expect(msg).toContain("1")
  })

  it("explains a removal differently from a reduction", () => {
    const removed = describeReceiptConflicts(
      receiptConflicts([{ id: "l1", remove: true }], { l1: 2 })
    )
    expect(removed).toMatch(/cannot be removed/)
    expect(removed).not.toMatch(/reduced/)
  })

  it("joins several conflicts readably", () => {
    const msg = describeReceiptConflicts(
      receiptConflicts([{ id: "l1", quantity: 0 }, { id: "l2", remove: true }], {
        l1: 2,
        l2: 1,
      })
    )
    expect(msg.split("; ")).toHaveLength(2)
  })
})
