/**
 * #2029 item 3 — which reservations follow the goods on a transfer receipt.
 *
 * This decides where physical stock ends up. `repointReservations` moves a run's
 * reservations to the destination; leave one behind and the origin owes a unit
 * it no longer has while the destination holds one nothing has claimed — the
 * same negative split, one step later.
 *
 * The fact used to live only in `reservation.metadata.production_run_id`, so the
 * filter had to run in-app over every reservation at the location. It now has a
 * typed link, and this is the choice between the two.
 */

import { selectRunReservations } from "../receive-goods-transfer"

const RUN = "prod_run_1"

const res = (id: string, runId?: string | null) => ({
  id,
  metadata: runId === undefined ? undefined : { production_run_id: runId },
})

describe("selectRunReservations", () => {
  it("uses the link when it says anything", () => {
    const rows = [res("r1", RUN), res("r2", "other_run"), res("r3", null)]
    const picked = selectRunReservations(rows, RUN, new Set(["r2", "r3"]))
    expect(picked.map((r) => r.id)).toEqual(["r2", "r3"])
  })

  /**
   * The reason to type it at all: a reservation the link claims but whose blob
   * was never written — or was written with the wrong run — still belongs to
   * the run. Under the blob scan it stayed behind when the goods moved.
   */
  it("catches a linked reservation the blob does not mention", () => {
    const rows = [res("r1", RUN), res("r_untagged")]
    expect(selectRunReservations(rows, RUN).map((r) => r.id)).toEqual(["r1"])
    expect(
      selectRunReservations(rows, RUN, new Set(["r1", "r_untagged"])).map((r) => r.id)
    ).toEqual(["r1", "r_untagged"])
  })

  /**
   * 🔴 An empty link result is indistinguishable from "this run holds no
   * reservations". Believing it would strand every reservation created before
   * the link existed — which is all of them, today.
   */
  it("falls back to the blob when the link says NOTHING", () => {
    const rows = [res("r1", RUN), res("r2", "other_run")]
    expect(selectRunReservations(rows, RUN, new Set()).map((r) => r.id)).toEqual(["r1"])
    expect(selectRunReservations(rows, RUN, null).map((r) => r.id)).toEqual(["r1"])
    expect(selectRunReservations(rows, RUN).map((r) => r.id)).toEqual(["r1"])
  })

  /**
   * ⚠️ The link is intersected with a list already scoped to the ORIGIN
   * location — it is not used to fetch reservations directly. A reservation the
   * run holds somewhere else must not be dragged to this destination by a
   * receipt it had nothing to do with. Expressed here as: nothing outside the
   * input list can come back, however much the link claims.
   */
  it("never returns a reservation that was not in the location's list", () => {
    const rows = [res("r1", RUN)]
    const picked = selectRunReservations(rows, RUN, new Set(["r1", "elsewhere_1"]))
    expect(picked.map((r) => r.id)).toEqual(["r1"])
  })

  it("survives junk", () => {
    expect(selectRunReservations(null, RUN)).toEqual([])
    expect(selectRunReservations(undefined, RUN, new Set(["x"]))).toEqual([])
    expect(selectRunReservations([], RUN)).toEqual([])
    // A blob with no run id is not a match for a run whose id is falsy-ish.
    expect(selectRunReservations([res("r1", "")], RUN)).toEqual([])
    expect(selectRunReservations([res("r1")], RUN)).toEqual([])
  })
})
