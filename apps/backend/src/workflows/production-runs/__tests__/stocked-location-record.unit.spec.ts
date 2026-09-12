import { stockedLocationRecordFor } from "../partner-run-steps"

/**
 * #891 S1 — what a completed run records about where its output went.
 *
 * The incident this exists to prevent:
 *
 *   12:37:28.956  child run completes (partner Sharlho)
 *   12:37:29.087  level created at Sharlho Store Warehouse = 1
 *   14:01:55      fulfillment ships from Dharamshala:  0 - 1 = -1
 *
 * `+1` at the partner and `-1` at the house summed to 0 — a correct TOTAL with
 * a wrong SPLIT. It stayed invisible for 84 minutes because nothing on the run
 * said where the goods had been banked.
 *
 * The failure mode of the FIX is the mirror image: recording a location for a
 * run that banked nothing invents a split that never happened. Every "no"
 * case below is a real early return inside `stockFinishedGoodsStep`, each of
 * which leaves a perfectly good partner location sitting on the step's input.
 */

const AT = new Date("2026-09-12T00:00:00.000Z")
const SHARLHO = "sloc_01KKTXV7B3EFCNSAK4WD1JQW7A"

describe("stockedLocationRecordFor", () => {
  it("records the location, the banked quantity and when, once goods are banked", () => {
    expect(
      stockedLocationRecordFor(
        { stocked: true, location_id: SHARLHO, quantity: 1 },
        AT
      )
    ).toEqual({
      stocked_at_location_id: SHARLHO,
      stocked_quantity: 1,
      stocked_at: AT,
    })
  })

  it("records the quantity BANKED, not the quantity ordered", () => {
    // A run ordered for 5 that produced 3 good units banks 3. Recording 5 here
    // would restate the ordered figure as stock that exists.
    const record = stockedLocationRecordFor(
      { stocked: true, location_id: SHARLHO, quantity: 3 },
      AT
    )
    expect(record?.stocked_quantity).toBe(3)
  })

  it("records NOTHING when the step banked nothing, even with a location on hand", () => {
    // 🔑 The load-bearing case. `location_id` is present and valid; `stocked`
    // is false. This is a rejected-only run, or an aggregate parent, or a
    // design with no resolvable variant. The run must not claim goods here.
    expect(
      stockedLocationRecordFor({ stocked: false, location_id: SHARLHO }, AT)
    ).toBeNull()
  })

  it("records nothing when the run had no location at all", () => {
    expect(stockedLocationRecordFor({ stocked: true }, AT)).toBeNull()
    expect(
      stockedLocationRecordFor({ stocked: true, location_id: null }, AT)
    ).toBeNull()
  })

  it("records nothing for a missing result rather than throwing", () => {
    // The step is best-effort: the goods are already banked and the partner is
    // already owed by the time it runs. It must never be the thing that fails
    // a completion.
    expect(stockedLocationRecordFor(null, AT)).toBeNull()
    expect(stockedLocationRecordFor(undefined, AT)).toBeNull()
  })

  it("treats a banked 0 as a recorded number, not an absence", () => {
    // `?? null` rather than `|| null`. 0 should not reach here — the step
    // returns early on `good_quantity <= 0` — but if it ever did, 0 units at a
    // known location is a fact, and `null` would read as "never recorded".
    const record = stockedLocationRecordFor(
      { stocked: true, location_id: SHARLHO, quantity: 0 },
      AT
    )
    expect(record?.stocked_quantity).toBe(0)
  })
})
