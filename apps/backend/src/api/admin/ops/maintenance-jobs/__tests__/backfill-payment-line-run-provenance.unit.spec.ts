import { recoverRunIdFromMetadata } from "../backfill-payment-line-run-provenance-job"

/**
 * The run id a payout already states — under whichever of the two spellings
 * the writer happened to use (#1565).
 *
 * 🔴 Two writers recorded one fact two ways and neither reached the column that
 * guards the money: `metadata.production_run_id` (the auto-draft subscriber)
 * and `metadata.source_production_run_id` (the admin screen). That is #1557's
 * shape — `metadata` validates as `z.record(z.string(), z.any())`, so both
 * store cleanly and neither guards anything.
 */
describe("recoverRunIdFromMetadata", () => {
  it("reads the auto-draft subscriber's spelling", () => {
    expect(
      recoverRunIdFromMetadata({ production_run_id: "prod_run_A" })
    ).toEqual({ runId: "prod_run_A", key: "production_run_id", conflict: false })
  })

  it("reads the admin screen's spelling", () => {
    // Five of production's thirteen submissions use the first key and four use
    // this one. A job that knew only one spelling would silently leave the
    // other four reporting "no run billed".
    expect(
      recoverRunIdFromMetadata({ source_production_run_id: "prod_run_B" })
    ).toEqual({
      runId: "prod_run_B",
      key: "source_production_run_id",
      conflict: false,
    })
  })

  it("accepts both keys when they agree", () => {
    expect(
      recoverRunIdFromMetadata({
        production_run_id: "prod_run_C",
        source_production_run_id: "prod_run_C",
      })
    ).toEqual({
      runId: "prod_run_C",
      key: "production_run_id",
      conflict: false,
    })
  })

  it("refuses to choose when the two keys disagree", () => {
    // 🔴 Two names for one payout's run that do not match is a contradiction,
    // not a fact. Picking either would write a provenance nobody stated —
    // and a WRONG run id is worse than none: it reports `billed` and silently
    // blocks a partner's real payout.
    expect(
      recoverRunIdFromMetadata({
        production_run_id: "prod_run_D",
        source_production_run_id: "prod_run_E",
      })
    ).toEqual({ runId: null, key: null, conflict: true })
  })

  it("recovers nothing from metadata that never recorded a run", () => {
    // The honest outcome for a genuinely unrecorded payout: the information was
    // never created, and the job must not invent it. The line stays
    // `not_recorded` — "not added to bills".
    for (const md of [
      null,
      undefined,
      {},
      { created_by: "admin" },
      { task_cost_overrides: { t1: 2500 } },
    ]) {
      expect(recoverRunIdFromMetadata(md as any)).toEqual({
        runId: null,
        key: null,
        conflict: false,
      })
    }
  })

  it("ignores a key present but not a usable string", () => {
    // An empty string is not an id, and a non-string would become "undefined"
    // or "[object Object]" downstream — a run id that matches nothing while
    // looking, in the column, exactly like a recorded one.
    for (const bad of ["", null, 42, {}, []]) {
      expect(recoverRunIdFromMetadata({ production_run_id: bad } as any)).toEqual(
        { runId: null, key: null, conflict: false }
      )
    }
  })
})
