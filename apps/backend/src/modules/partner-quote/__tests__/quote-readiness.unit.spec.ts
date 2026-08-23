import { needsManualFreightRate } from "../lib/quote-readiness"

/**
 * When a lane cannot be rated, refuse rather than invent (#1439 S12 tail).
 *
 * ## What this pins
 *
 * International freight on prod is FLAT AT ANY WEIGHT — 35 EUR at 3 kg and
 * 35 EUR at 22 kg — because the carrier answers "No serviceable couriers
 * available for given weight" and the picker falls through to whatever manual
 * shipping option the store happens to have configured. Readiness answered
 * `ready: true` and the quote went out carrying that number.
 *
 * 🔑 That is the same shape this epic has already shipped three times: a
 * plausible figure standing in for an unknown one — zone-blind (#1424),
 * rule-blind (#1430), and the return option winning every domestic lane
 * (#1485). None looked broken, because none was ever missing.
 *
 * The remedy already exists. S12's `freight_override_amount` lets a partner
 * read the real DHL rate and type it, badged "By hand" with its basis
 * recorded. So the rule is: carrier failed AND nobody typed a rate ⇒ refuse
 * and say so. A typed rate answers the question outright.
 */
describe("needsManualFreightRate", () => {
  it("🔴 refuses when the carrier failed and nobody typed a rate", () => {
    expect(
      needsManualFreightRate("No serviceable couriers available", null)
    ).toBe(true)
  })

  it("accepts once someone has typed the rate", () => {
    expect(
      needsManualFreightRate("No serviceable couriers available", 4200)
    ).toBe(false)
  })

  /**
   * A rated lane is not second-guessed. The domestic lane rates cleanly and
   * must keep minting without anyone typing anything.
   */
  it("says nothing when the carrier answered", () => {
    expect(needsManualFreightRate(null, null)).toBe(false)
    expect(needsManualFreightRate(undefined, null)).toBe(false)
  })

  /**
   * 🔴 Zero is a typed answer, not an absence. `freight_override_amount` is
   * validated `.positive()` at the API boundary precisely so a zero cannot be
   * typed by accident — but this predicate must not be the thing that treats a
   * present number as missing, or free freight would silently become
   * "unrateable" instead of being refused where it is actually checked.
   */
  it("treats a typed zero as an answer, not as absence", () => {
    expect(needsManualFreightRate("carrier down", 0)).toBe(false)
  })

  it("ignores an empty error string — that is not a failure", () => {
    expect(needsManualFreightRate("", null)).toBe(false)
  })
})
