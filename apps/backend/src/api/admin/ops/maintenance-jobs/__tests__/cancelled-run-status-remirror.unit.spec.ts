import {
  decideRunStatusRemirrors,
  expectedPartnerStatusFor,
  summarizeRemirrorDecisions,
  type MirrorCandidate,
} from "../lib/cancelled-run-status-remirror"

/**
 * #1574 — the classification behind the cancelled-run repair.
 *
 * The bug being repaired is that a cancelled run left `partner_status` saying
 * `in_progress` forever. The risk in the REPAIR is the mirror image: writing
 * "cancelled" onto an order that is legitimately still live because only one
 * of its runs was called off. Both directions are asserted here.
 */
const run = (
  id: string,
  status: string,
  stamps: Record<string, string> = {}
) => ({ id, status, ...stamps })

const candidate = (over: Partial<MirrorCandidate>): MirrorCandidate => ({
  run_id: "prod_run_1",
  run: run("prod_run_1", "cancelled"),
  unified_order_id: "order_1",
  linked_runs: [run("prod_run_1", "cancelled")],
  ...over,
})

describe("decideRunStatusRemirrors", () => {
  it("flags the #1577 case — a cancelled run whose order still says in_progress", () => {
    const [d] = decideRunStatusRemirrors([
      candidate({ current_partner_status: "in_progress" }),
    ])
    expect(d.verdict).toBe("stale")
    expect(d.current_partner_status).toBe("in_progress")
    expect(d.expected_partner_status).toBe("cancelled")
  })

  it("flags an order whose sidecar was never written at all", () => {
    const [d] = decideRunStatusRemirrors([
      candidate({ current_partner_status: null }),
    ])
    expect(d.verdict).toBe("stale")
    expect(d.note).toContain("(unset)")
  })

  it("leaves a run that already reads cancelled alone", () => {
    const [d] = decideRunStatusRemirrors([
      candidate({ current_partner_status: "cancelled" }),
    ])
    expect(d.verdict).toBe("already_correct")
  })

  it("🔴 does NOT cancel a collated order that is still live", () => {
    // One cancelled run among four in flight. Predicting "cancelled" here
    // would make the repair write a lie onto a healthy order — the exact
    // inverse of the bug it exists to fix.
    const linked = [
      run("prod_run_1", "cancelled"),
      run("prod_run_2", "in_progress", { started_at: "2026-08-01T00:00:00Z" }),
      run("prod_run_3", "in_progress", { accepted_at: "2026-08-01T00:00:00Z" }),
      run("prod_run_4", "sent_to_partner"),
    ]
    const [d] = decideRunStatusRemirrors([
      candidate({ linked_runs: linked, current_partner_status: "assigned" }),
    ])
    expect(d.expected_partner_status).toBe("assigned")
    expect(d.verdict).toBe("already_correct")
  })

  it("cancels a collated order only when every run is cancelled", () => {
    const linked = [
      run("prod_run_1", "cancelled"),
      run("prod_run_2", "cancelled"),
    ]
    const [d] = decideRunStatusRemirrors([
      candidate({ linked_runs: linked, current_partner_status: "finished" }),
    ])
    expect(d.verdict).toBe("stale")
    expect(d.expected_partner_status).toBe("cancelled")
    expect(d.note).toContain("collated order of 2 runs")
  })

  it("🔑 reports an unjudgeable row as undeterminable, never as correct", () => {
    // A draft run derives no partner_status, so the mirror would write
    // nothing. Calling that "already_correct" is how the original bug hid.
    const [d] = decideRunStatusRemirrors([
      candidate({
        run: run("prod_run_1", "draft"),
        linked_runs: [run("prod_run_1", "draft")],
        current_partner_status: "in_progress",
      }),
    ])
    expect(d.verdict).toBe("undeterminable")
    expect(d.expected_partner_status).toBeUndefined()
  })

  it("skips a superseded parent and an unlinked run without calling them broken", () => {
    const [sup, unlinked] = decideRunStatusRemirrors([
      candidate({ superseded: true, current_partner_status: "in_progress" }),
      candidate({ run_id: "prod_run_9", unified_order_id: null }),
    ])
    expect(sup.verdict).toBe("superseded")
    expect(unlinked.verdict).toBe("no_unified_order")
  })
})

describe("expectedPartnerStatusFor", () => {
  it("uses the per-run mapping for a single-run order", () => {
    expect(
      expectedPartnerStatusFor(
        candidate({
          run: run("prod_run_1", "in_progress", {
            finished_at: "2026-08-01T00:00:00Z",
          }),
          linked_runs: [
            run("prod_run_1", "in_progress", {
              finished_at: "2026-08-01T00:00:00Z",
            }),
          ],
        })
      )
    ).toBe("finished")
  })
})

describe("summarizeRemirrorDecisions", () => {
  it("counts every bucket, so a summary never implies the ones it omits", () => {
    const counts = summarizeRemirrorDecisions(
      decideRunStatusRemirrors([
        candidate({ current_partner_status: "in_progress" }),
        candidate({ current_partner_status: "cancelled" }),
        candidate({ unified_order_id: null }),
        candidate({ superseded: true }),
        candidate({
          run: run("prod_run_5", "approved"),
          linked_runs: [run("prod_run_5", "approved")],
        }),
      ])
    )
    expect(counts).toEqual({
      stale: 1,
      already_correct: 1,
      no_unified_order: 1,
      superseded: 1,
      undeterminable: 1,
    })
  })
})
