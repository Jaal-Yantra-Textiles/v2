import { runBillableCeiling } from "../run-billable-ceiling"

/**
 * #1596 short-close. The ceiling decides how much a partner may still claim, so
 * the cases that matter are the ones where it must NOT move.
 */
describe("runBillableCeiling", () => {
  it("is the ORDERED quantity while the run is open, even when less was produced", () => {
    // The whole reason short-close exists: produced is captured at completion
    // and more can legitimately follow, so 7-of-9 keeps 2 units billable.
    expect(
      runBillableCeiling({ quantity: 9, produced_quantity: 7 })
    ).toBe(9)
  })

  it("becomes the PRODUCED quantity once short-closed", () => {
    expect(
      runBillableCeiling({
        quantity: 9,
        produced_quantity: 7,
        short_closed_at: new Date("2026-08-30"),
      })
    ).toBe(7)
  })

  it("does not reduce a closed run whose output figure cannot be read", () => {
    // An absent number must never quietly cost a partner their claim.
    expect(
      runBillableCeiling({
        quantity: 9,
        produced_quantity: null,
        short_closed_at: new Date("2026-08-30"),
      })
    ).toBe(9)
    expect(
      runBillableCeiling({
        quantity: 9,
        produced_quantity: 0,
        short_closed_at: new Date("2026-08-30"),
      })
    ).toBe(9)
  })

  it("never raises the ceiling above what was ordered, even if more was produced", () => {
    expect(
      runBillableCeiling({
        quantity: 9,
        produced_quantity: 12,
        short_closed_at: new Date("2026-08-30"),
      })
    ).toBe(9)
  })

  it("returns null when the run states no ordered quantity — no ceiling is a refusal, not room", () => {
    expect(runBillableCeiling({ quantity: null })).toBeNull()
    expect(runBillableCeiling({ quantity: 0 })).toBeNull()
    expect(runBillableCeiling(null)).toBeNull()
  })

  it("reports a ceiling BELOW what may already have been billed, rather than hiding it", () => {
    // Ordered 9, billed 7 under the open ceiling, then closed at 4. There is no
    // clawback: the ceiling is honest and the write guard refuses anything more.
    expect(
      runBillableCeiling({
        quantity: 9,
        produced_quantity: 4,
        short_closed_at: new Date("2026-08-30"),
      })
    ).toBe(4)
  })

  it("accepts the string quantities the DB hands back for numeric columns", () => {
    expect(
      runBillableCeiling({
        quantity: "9",
        produced_quantity: "7",
        short_closed_at: "2026-08-30T00:00:00.000Z",
      })
    ).toBe(7)
  })
})
