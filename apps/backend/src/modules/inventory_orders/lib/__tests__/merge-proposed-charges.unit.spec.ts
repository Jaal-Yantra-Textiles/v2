import { mergeProposedCharges } from "../merge-proposed-charges"

/**
 * Re-proposing a tax must not charge twice (#1752).
 *
 * The case: a partner proposes 18% tax on the GOF order — ₹12,481.20 — then
 * notices a typo in a quantity and submits again. Staging APPENDED, and
 * approval promotes every proposed charge into a real one, so the order carried
 * two tax charges and the partner's screen showed one.
 */
describe("mergeProposedCharges", () => {
  const tax = (amount: number, note = "18% tax on goods total") => ({
    type: "tax",
    amount,
    note,
  })

  it("🔴 a re-proposed tax REPLACES the staged one — submitting twice does not charge twice", () => {
    const after = mergeProposedCharges([tax(12481.2)], [tax(12481.2)])
    expect(after).toHaveLength(1)
    expect(after[0].amount).toBe(12481.2)
  })

  it("a corrected tax supersedes the old amount rather than adding to it", () => {
    const after = mergeProposedCharges([tax(12481.2)], [tax(9000)])
    expect(after).toEqual([tax(9000)])
  })

  it("🔴 amount 0 WITHDRAWS the staged tax — the only way to take one back", () => {
    // Before this, setting the percent to 0 sent nothing, so the screen showed
    // no tax while the staged change still carried one.
    expect(mergeProposedCharges([tax(12481.2)], [tax(0, "")])).toEqual([])
  })

  it("a 0 for a type that was never staged adds nothing", () => {
    expect(mergeProposedCharges([], [tax(0)])).toEqual([])
  })

  it("🔴 leaves charges of OTHER types alone", () => {
    // The partner surface only proposes tax, but a restated tax must not
    // silently drop a shipping charge someone else staged.
    const shipping = { type: "shipping", amount: 500, note: null }
    const after = mergeProposedCharges([shipping, tax(100)], [tax(250)])
    expect(after).toEqual([shipping, tax(250)])
  })

  it("keeps a replaced charge in its original position", () => {
    const shipping = { type: "shipping", amount: 500, note: null }
    const after = mergeProposedCharges([tax(100), shipping], [tax(250)])
    expect(after.map((c) => c.type)).toEqual(["tax", "shipping"])
  })

  it("appends a type that was not staged before", () => {
    const shipping = { type: "shipping", amount: 500, note: null }
    expect(mergeProposedCharges([shipping], [tax(300)])).toEqual([shipping, tax(300)])
  })

  it("returns the staged set untouched when nothing is incoming", () => {
    expect(mergeProposedCharges([tax(100)], [])).toEqual([tax(100)])
    expect(mergeProposedCharges([tax(100)], null)).toEqual([tax(100)])
    expect(mergeProposedCharges([tax(100)], undefined)).toEqual([tax(100)])
  })

  it("treats a missing or non-array staged value as empty rather than throwing", () => {
    expect(mergeProposedCharges(null, [tax(100)])).toEqual([tax(100)])
    expect(mergeProposedCharges({ not: "an array" }, [tax(100)])).toEqual([tax(100)])
  })

  it("drops nulls in the staged array instead of carrying them into approval", () => {
    expect(mergeProposedCharges([null, tax(100)], [])).toEqual([tax(100)])
  })

  it("🔴 never stages a zero-amount charge — approval would promote it to a real ₹0 row", () => {
    const after = mergeProposedCharges([], [tax(0)])
    expect(after.every((c) => Number(c.amount) > 0)).toBe(true)
  })

  it("takes the last entry when one request names the same type twice", () => {
    expect(mergeProposedCharges([], [tax(100), tax(250)])).toEqual([tax(250)])
  })
})
