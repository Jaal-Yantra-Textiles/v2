import {
  designsBlockedByOpenClaims,
  designOpenClaimsMessage,
} from "../design-open-claims"

/**
 * #1596. This guard used to refuse any second submission on a design that had
 * an open one. A run is claimed by QUANTITY now, so billing 4 of a run ordered
 * for 9 and returning for the rest is legitimate — and the design-level check
 * refused it on the strength of the design alone.
 *
 * 🔴 It is a MONEY guard, so the tests that matter most are the ones proving it
 * still refuses. It stands down in exactly one situation: both this claim and
 * every open prior name their runs, which is when `assessRunClaims` has the
 * arithmetic. Everything else — an opaque prior, a claim naming no runs, an
 * open submission whose lines we cannot see — must keep blocking.
 */
const openMap = (entries: Record<string, string[]>) =>
  new Map(Object.entries(entries))

describe("designsBlockedByOpenClaims (#1596)", () => {
  it("lets a second run-named claim through when the open prior names its runs too", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_b"] },
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: ["run_a"],
        },
      ],
    })
    expect(blocked).toEqual([])
  })

  it("lets a SECOND TRANCHE of the same run through — the run guard owns that arithmetic", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_a"] },
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: ["run_a"],
        },
      ],
    })
    expect(blocked).toEqual([])
  })

  it("still refuses when THIS claim names no runs — nothing to diff on our side", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: {},
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: ["run_a"],
        },
      ],
    })
    expect(blocked).toHaveLength(1)
    expect(blocked[0].reason).toBe("no_runs_claimed")
  })

  it("still refuses when the OPEN PRIOR names no runs — that claim is invisible to the run guard", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_a"] },
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          // `not_recorded`: pays for run work, records no evidence of which.
          production_run_ids: [],
        },
      ],
    })
    expect(blocked).toHaveLength(1)
    expect(blocked[0].reason).toBe("prior_claim_names_no_runs")
  })

  it("refuses when the open submission's lines cannot be seen at all — absence is not permission", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_a"] },
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [],
    })
    expect(blocked).toHaveLength(1)
    expect(blocked[0].reason).toBe("prior_claim_names_no_runs")
  })

  it("refuses if ANY of several open priors is opaque, even when another names its runs", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_c"] },
      open_submissions_by_design: openMap({
        design_1: ["sub_clean", "sub_opaque"],
      }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_clean",
          submission_status: "Pending",
          production_run_ids: ["run_a"],
        },
        {
          design_id: "design_1",
          submission_id: "sub_opaque",
          submission_status: "Pending",
          production_run_ids: [],
        },
      ],
    })
    expect(blocked).toHaveLength(1)
    expect(blocked[0].submission_ids).toEqual(["sub_opaque"])
  })

  it("refuses when a prior line names runs but a SIBLING line on the same design does not", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_c"] },
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: ["run_a"],
        },
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: null,
        },
      ],
    })
    expect(blocked).toHaveLength(1)
    expect(blocked[0].reason).toBe("prior_claim_names_no_runs")
  })

  it("ignores a prior line for a DIFFERENT design in the same submission", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: { design_1: ["run_c"] },
      open_submissions_by_design: openMap({ design_1: ["sub_open"] }),
      prior_lines: [
        {
          design_id: "design_1",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: ["run_a"],
        },
        {
          design_id: "design_2",
          submission_id: "sub_open",
          submission_status: "Pending",
          production_run_ids: [],
        },
      ],
    })
    expect(blocked).toEqual([])
  })

  it("does not block a design with no open submission at all", () => {
    const blocked = designsBlockedByOpenClaims({
      design_ids: ["design_1"],
      claimed_runs: {},
      open_submissions_by_design: openMap({}),
      prior_lines: [],
    })
    expect(blocked).toEqual([])
  })

  it("says what would make the refusal go away", () => {
    const message = designOpenClaimsMessage([
      {
        design_id: "design_1",
        submission_ids: ["sub_open"],
        reason: "no_runs_claimed",
      },
    ])
    expect(message).toContain("design_1")
    expect(message).toContain("sub_open")
    expect(message).toMatch(/name the production runs/)
  })
})
