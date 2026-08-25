import { needsManualFreightRate } from "../lib/quote-readiness"

/**
 * When a lane cannot be rated, refuse rather than invent (#1439 S12 tail,
 * widened by #1528).
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
 * ## 🔴 Why the suite was green while the defect was live (#1528)
 *
 * Every case below the fold used to pass an ERROR STRING. The guard was
 * `Boolean(calculatedError) && override === null`, so the tests exercised the
 * only branch it had, all agreed, and the case that actually shipped — a
 * carrier answering an EMPTY LIST with no error at all — was never written
 * down. A real Amsterdam quote went out at `ready: true` on a flat €35, hours
 * after the same lane returned seven carrier options with the cheapest at
 * €36.42.
 *
 * So the fixtures here now say what the carrier DID, not merely what it
 * raised. `carrierConsulted` is the load-bearing one: without it an empty list
 * cannot be told apart from a store that deliberately prices by hand, and
 * refusing that would block every manual lane on purpose.
 */

/** The shape under test, with the benign answer as the default. */
const ask = (over: Partial<Parameters<typeof needsManualFreightRate>[0]> = {}) =>
  needsManualFreightRate({
    calculatedError: null,
    carrierConsulted: true,
    chosenSource: "calculated",
    override: null,
    ...over,
  })

describe("needsManualFreightRate", () => {
  it("🔴 refuses when the carrier failed and nobody typed a rate", () => {
    expect(
      ask({
        calculatedError: "No serviceable couriers available",
        chosenSource: "manual",
      })
    ).toBe(true)
  })

  /**
   * 🔴 THE CASE THAT SHIPPED (#1528).
   *
   * No error, no rates, and a flat tier about to be frozen as if a carrier had
   * chosen it. Under the old guard this returned `false` — which is exactly
   * how a €35 flat rate reached a real customer while readiness reported
   * `ready=true, blocking=0, error=null`.
   *
   * 🔑 This assertion fails on the previous implementation. That is the point
   * of writing it: a test that passes both before and after certifies nothing
   * (#1495).
   */
  it("🔴 refuses when the carrier was asked and returned NOTHING — no rates, no error", () => {
    expect(
      ask({
        calculatedError: null,
        carrierConsulted: true,
        chosenSource: "manual",
      })
    ).toBe(true)
  })

  it("accepts once someone has typed the rate", () => {
    expect(
      ask({
        calculatedError: "No serviceable couriers available",
        chosenSource: "manual",
        override: 4200,
      })
    ).toBe(false)
  })

  /**
   * A carrier rate won the lane. Whatever else the estimate reported, the
   * number being frozen is a real quote for this weight to this destination —
   * which is the only question this guard is asking.
   */
  it("says nothing when a carrier rate is the figure being frozen", () => {
    expect(ask({ chosenSource: "calculated" })).toBe(false)
    // Even alongside a partial failure: some couriers erred, one still rated.
    expect(
      ask({ calculatedError: "courier X timed out", chosenSource: "calculated" })
    ).toBe(false)
  })

  /**
   * 🔑 `carrier: "manual"` / `"none"` is an explicit decision to ask NOBODY —
   * `buildShippingEstimate` returns early with an empty `calculated` list and
   * a null error, which is byte-identical to the failure above.
   *
   * Only `carrier_consulted` separates them, and getting this wrong is not a
   * small mistake in the safe direction: it would refuse every hand-priced
   * lane the store has configured on purpose, and no quote from such a store
   * could be minted at all.
   */
  it("stays silent when no carrier was consulted — pricing by hand is the plan", () => {
    expect(
      ask({
        calculatedError: null,
        carrierConsulted: false,
        chosenSource: "manual",
      })
    ).toBe(false)
  })

  /**
   * 🔴 Zero is a typed answer, not an absence. `freight_override_amount` is
   * how a partner says "I looked this lane up and it ships free" — a real
   * commercial decision on a sample or a make-good. Treating 0 as "nothing was
   * typed" would refuse the one quote the partner was most deliberate about.
   */
  it("treats a typed zero as an answer, not as absence", () => {
    expect(
      ask({
        calculatedError: "carrier down",
        chosenSource: "manual",
        override: 0,
      })
    ).toBe(false)
  })

  /**
   * An empty error string is not a failure — but with the guard widened it no
   * longer matters what the string says. What decides is whether a carrier
   * rate is the number being frozen.
   */
  it("does not depend on the error string once a carrier rate won", () => {
    expect(ask({ calculatedError: "", chosenSource: "calculated" })).toBe(false)
  })
})
