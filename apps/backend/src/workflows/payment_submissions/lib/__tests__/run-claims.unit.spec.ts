import {
  foldRunClaims,
  listPartnerRunClaims,
  runsAlreadyClaimedMessage,
} from "../run-claims"

/**
 * The defect these cover: every "is this run already paid for" guard fetched
 * priors with `{ design_id: [...] }`, so a claim held by a line with
 * `design_id: null` was invisible and the run could be billed twice.
 *
 * The load-bearing case is `finds a claim held by a line with no design_id`.
 * Against the old design-scoped query that case CANNOT pass — the prior is
 * simply not in the result set.
 */
describe("foldRunClaims", () => {
  it("finds a claim held by a line with no design_id", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_run_sourced",
        submission_status: "Paid",
        production_run_ids: ["run_a", "run_b"],
      },
    ])

    expect(claims.get("run_a")).toEqual({
      submission_id: "sub_run_sourced",
      submission_status: "Paid",
    })
    expect(claims.get("run_b")?.submission_id).toBe("sub_run_sourced")
  })

  it("ignores a Rejected submission — its lines release their runs", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_rejected",
        submission_status: "Rejected",
        production_run_ids: ["run_a"],
      },
    ])

    expect(claims.has("run_a")).toBe(false)
  })

  it("treats a Draft as a live claim on a named run", () => {
    // Unlike the runless guard, which exempts Draft so a partner can submit
    // the auto-draft they were handed. A run NAMED by a draft is different.
    const claims = foldRunClaims([
      {
        submission_id: "sub_draft",
        submission_status: "Draft",
        production_run_ids: ["run_a"],
      },
    ])

    expect(claims.get("run_a")?.submission_status).toBe("Draft")
  })

  it("keeps the earliest claim when two lines name the same run", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_first",
        submission_status: "Paid",
        production_run_ids: ["run_a"],
      },
      {
        submission_id: "sub_second",
        submission_status: "Pending",
        production_run_ids: ["run_a"],
      },
    ])

    expect(claims.get("run_a")?.submission_id).toBe("sub_first")
  })

  it("tolerates a line with no runs at all", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_task",
        submission_status: "Paid",
        production_run_ids: null,
      },
    ])

    expect(claims.size).toBe(0)
  })
})

describe("listPartnerRunClaims", () => {
  const service = (submissions: any[], items: any[]) => ({
    listPaymentSubmissions: jest.fn().mockResolvedValue(submissions),
    listPaymentSubmissionItems: jest.fn().mockResolvedValue(items),
  })

  it("sees a run-sourced claim that a design-scoped query would miss", async () => {
    const svc = service(
      [{ id: "sub_1" }],
      [
        {
          submission_id: "sub_1",
          submission: { id: "sub_1", status: "Paid" },
          design_id: null, // ← the whole point
          production_run_ids: ["run_order_79"],
        },
      ]
    )

    const claims = await listPartnerRunClaims(svc as any, "partner_1")

    expect(claims.has("run_order_79")).toBe(true)
    // Scoped by partner, so the submission lookup is the partner's, not a design's.
    expect(svc.listPaymentSubmissions).toHaveBeenCalledWith({
      partner_id: "partner_1",
    })
  })

  it("excludes the submission being edited, so a claim cannot conflict with itself", async () => {
    const svc = service(
      [{ id: "sub_self" }, { id: "sub_other" }],
      [
        {
          submission_id: "sub_other",
          submission: { id: "sub_other", status: "Pending" },
          production_run_ids: ["run_b"],
        },
      ]
    )

    await listPartnerRunClaims(svc as any, "partner_1", {
      excludeSubmissionId: "sub_self",
    })

    expect(svc.listPaymentSubmissionItems).toHaveBeenCalledWith(
      { submission_id: ["sub_other"] },
      { relations: ["submission"] }
    )
  })

  it("returns empty without querying items when the partner has no submissions", async () => {
    const svc = service([], [])

    const claims = await listPartnerRunClaims(svc as any, "partner_1")

    expect(claims.size).toBe(0)
    expect(svc.listPaymentSubmissionItems).not.toHaveBeenCalled()
  })

  it("returns empty for a missing partner id rather than querying every row", async () => {
    const svc = service([{ id: "sub_1" }], [])

    const claims = await listPartnerRunClaims(svc as any, "")

    expect(claims.size).toBe(0)
    expect(svc.listPaymentSubmissions).not.toHaveBeenCalled()
  })
})

describe("runsAlreadyClaimedMessage", () => {
  it("names the submission holding each run", () => {
    const claims = foldRunClaims([
      {
        submission_id: "sub_1",
        submission_status: "Paid",
        production_run_ids: ["run_a"],
      },
    ])

    expect(runsAlreadyClaimedMessage(["run_a"], claims)).toBe(
      "Production runs already paid for: run_a (submission sub_1, Paid)"
    )
  })
})
