/**
 * A design could be billed, paid, and billed again — as long as the second
 * claim named no runs. The design guard passes (nothing is open once it's
 * Paid), the run guard never executes (nothing was claimed), and the same work
 * is paid for twice with nothing in the record able to tell the claims apart.
 */
import {
  designsBilledWithoutRunEvidence,
  runlessResubmitMessage,
  type PriorSubmissionLine,
} from "../lib/run-evidence-guard"

const prior = (over: Partial<PriorSubmissionLine> = {}): PriorSubmissionLine => ({
  design_id: "des_1",
  submission_status: "Paid",
  submission_id: "ps_old",
  run_provenance: "recorded",
  ...over,
})

describe("designsBilledWithoutRunEvidence", () => {
  it("🔴 catches a re-bill that names no runs after the first was Paid", () => {
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: undefined,
      prior_lines: [prior()],
    })
    expect(out).toHaveLength(1)
    expect(out[0].prior_submission_id).toBe("ps_old")
    expect(out[0].prior_status).toBe("Paid")
  })

  it("also catches Approved, which the design guard stops covering", () => {
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: {},
      prior_lines: [prior({ submission_status: "Approved" })],
    })
    expect(out).toHaveLength(1)
  })

  it("stands aside when the new claim NAMES its runs", () => {
    // The run-level guard owns this design and is exact — two guards
    // disagreeing about one design is worse than either alone.
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: { des_1: ["run_9"] },
      prior_lines: [prior()],
    })
    expect(out).toEqual([])
  })

  it("treats an empty run list as naming nothing", () => {
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: { des_1: [] },
      prior_lines: [prior()],
    })
    expect(out).toHaveLength(1)
  })

  it("lets a first-ever submission through", () => {
    expect(
      designsBilledWithoutRunEvidence({
        design_ids: ["des_1"],
        claimed_runs: undefined,
        prior_lines: [],
      })
    ).toEqual([])
  })

  it("does not let another design's history block this one", () => {
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: undefined,
      prior_lines: [prior({ design_id: "des_OTHER" })],
    })
    expect(out).toEqual([])
  })

  /**
   * The regression #1602 shipped, caught while tracing why 7 Draft submissions
   * had piled up on prod.
   *
   * `auto-draft-payment-submission` drafts one on every completed run. The
   * partner then submits by hand — and that hand submission CANNOT name the
   * runs, because the Draft already holds a live claim on them (the run-level
   * guard refuses it). Naming no runs was the only way through. Blocking it
   * here left the design unbillable by any route: the Draft cannot be submitted
   * (no such route), cannot be rejected (review requires Pending/Under_Review)
   * and cannot be deleted (#1604).
   */
  it("🔴 a Draft prior does NOT block — it is the auto-draft being submitted", () => {
    const conflicts = designsBilledWithoutRunEvidence({
      design_ids: ["design_1"],
      claimed_runs: {},
      prior_lines: [
        {
          design_id: "design_1",
          submission_status: "Draft",
          submission_id: "sub_draft",
          run_provenance: "recorded",
        },
      ],
    })
    // Before the fix this returned a conflict, and the partner had no route
    // left to bill the design at all.
    expect(conflicts).toEqual([])
  })

  it("a Draft alongside a Paid prior still blocks — the Paid one is the claim", () => {
    const conflicts = designsBilledWithoutRunEvidence({
      design_ids: ["design_1"],
      claimed_runs: {},
      prior_lines: [
        {
          design_id: "design_1",
          submission_status: "Draft",
          submission_id: "sub_draft",
          run_provenance: "recorded",
        },
        {
          design_id: "design_1",
          submission_status: "Paid",
          submission_id: "sub_paid",
          run_provenance: "recorded",
        },
      ],
    })
    // Exempting Draft must not let a genuinely-paid prior through with it.
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].prior_submission_id).toBe("sub_paid")
    expect(conflicts[0].prior_status).toBe("Paid")
  })

  it("still blocks every status that actually took money", () => {
    for (const status of ["Pending", "Under_Review", "Approved", "Paid"]) {
      const conflicts = designsBilledWithoutRunEvidence({
        design_ids: ["design_1"],
        claimed_runs: {},
        prior_lines: [
          {
            design_id: "design_1",
            submission_status: status,
            submission_id: `sub_${status}`,
            run_provenance: "recorded",
          },
        ],
      })
      expect(conflicts).toHaveLength(1)
    }
  })

  it("🔑 a Rejected prior releases its claim", () => {
    // It never paid anyone, so it cannot be the thing being double-billed.
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: undefined,
      prior_lines: [prior({ submission_status: "Rejected" })],
    })
    expect(out).toEqual([])
  })

  it("🔑 a prior that says `no_run` does NOT block", () => {
    // `no_run` means nothing produced this work — it stakes no claim a run
    // could duplicate, so blocking on it would invent a problem.
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1"],
      claimed_runs: undefined,
      prior_lines: [prior({ run_provenance: "no_run" })],
    })
    expect(out).toEqual([])
  })

  it("🔴 blocks on `not_recorded`, and on an absent value", () => {
    // "Not written down" is not "no run". The model defaults to
    // `not_recorded` precisely because a writer that said nothing has not told
    // us there is no run — so the honest read is UNKNOWN, never clear.
    for (const provenance of ["not_recorded", null, undefined as any]) {
      const out = designsBilledWithoutRunEvidence({
        design_ids: ["des_1"],
        claimed_runs: undefined,
        prior_lines: [prior({ run_provenance: provenance })],
      })
      expect(out).toHaveLength(1)
    }
  })

  it("reports every conflicting design, not just the first", () => {
    // A partner fixing one design per round-trip is how a screen stops being
    // used — the same promise the readiness preflight makes.
    const out = designsBilledWithoutRunEvidence({
      design_ids: ["des_1", "des_2", "des_3"],
      claimed_runs: { des_2: ["run_2"] },
      prior_lines: [prior(), prior({ design_id: "des_3", submission_id: "ps_x" })],
    })
    expect(out.map((c) => c.design_id)).toEqual(["des_1", "des_3"])
  })
})

describe("runlessResubmitMessage", () => {
  it("names the design, the prior submission, and the fix", () => {
    const msg = runlessResubmitMessage([
      { design_id: "des_1", prior_submission_id: "ps_old", prior_status: "Paid" },
    ])
    expect(msg).toContain("des_1")
    expect(msg).toContain("ps_old")
    expect(msg).toContain("Paid")
    // The refusal has to be actionable in one step, not a support ticket.
    expect(msg).toMatch(/name the runs/i)
  })

  it("survives a prior with no id rather than printing undefined", () => {
    const msg = runlessResubmitMessage([
      { design_id: "des_1", prior_submission_id: null, prior_status: null },
    ])
    expect(msg).not.toContain("undefined")
    expect(msg).toContain("unknown")
  })
})
