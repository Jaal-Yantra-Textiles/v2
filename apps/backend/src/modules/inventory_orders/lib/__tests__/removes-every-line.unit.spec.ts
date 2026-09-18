import { removesEveryLine, type ProposedLine } from "../order-changes"

/**
 * #1752 — a partner's proposal must not empty the order.
 *
 * `order_lines.min(1)` counts markers, not survivors, so it passes a payload
 * that removes everything. These cases fix the distinction the min() cannot
 * make: how many lines the ORDER has left, not how many entries the PAYLOAD
 * has.
 */
describe("removesEveryLine", () => {
  const remove = (id: string): ProposedLine => ({ id, remove: true })
  const keep = (id: string, quantity = 5): ProposedLine => ({ id, quantity })

  it("is true when every line on the order is marked for removal", () => {
    expect(
      removesEveryLine([remove("l1"), remove("l2")], ["l1", "l2"])
    ).toBe(true)
  })

  it("is false when one line survives — removing 1 of 3 is a normal edit", () => {
    expect(
      removesEveryLine([remove("l1"), remove("l2")], ["l1", "l2", "l3"])
    ).toBe(false)
  })

  it("is false when a removal sits alongside a kept line in the same payload", () => {
    expect(removesEveryLine([remove("l1"), keep("l2")], ["l1", "l2"])).toBe(
      false
    )
  })

  /**
   * The payload is a set of OPS, not necessarily the whole order. A proposal
   * naming only `l1` leaves `l2` untouched and alive, so it must pass — this is
   * the case a naive `lines.every(l => l.remove)` gets wrong.
   */
  it("is false when the payload names only some of the order's lines", () => {
    expect(removesEveryLine([remove("l1")], ["l1", "l2"])).toBe(false)
  })

  it("is false for an order that has no lines to begin with", () => {
    expect(removesEveryLine([remove("l1")], [])).toBe(false)
  })

  it("ignores null/empty ids on either side rather than counting them as cover", () => {
    expect(
      removesEveryLine(
        [remove("l1"), { id: "", remove: true } as ProposedLine],
        ["l1", null, undefined, "l2"]
      )
    ).toBe(false)
  })

  it("compares ids as strings, so a numeric id still matches", () => {
    expect(
      removesEveryLine([{ id: 7 as any, remove: true }], [7 as any])
    ).toBe(true)
  })

  it("is false for an empty or missing proposal", () => {
    expect(removesEveryLine([], ["l1"])).toBe(false)
    expect(removesEveryLine(null, ["l1"])).toBe(false)
    expect(removesEveryLine(undefined, ["l1"])).toBe(false)
  })
})
