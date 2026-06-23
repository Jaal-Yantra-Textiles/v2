import { summarizeFlowInstall } from "../registry"

describe("install-marketing-ideas-email-flow — summarizeFlowInstall", () => {
  it("reports already-installed when existingId is set (dry-run, no apply)", () => {
    const result = summarizeFlowInstall({
      jobId: "install-marketing-ideas-email-flow",
      dry_run: true,
      flowName: "Marketing Daily Ideas Email — Daily",
      cron: "30 1 * * *",
      nodeCount: 3,
      existingId: "vf_existing",
      createdId: null,
    })
    expect(result.applied).toBe(false)
    expect(result.changes).toEqual([])
    expect(result.summary).toMatch(/already installed/)
    expect(result.summary).toContain("vf_existing")
    expect(result.job_id).toBe("install-marketing-ideas-email-flow")
  })

  it("reports would-create when dry-run and not existing", () => {
    const result = summarizeFlowInstall({
      jobId: "jid",
      dry_run: true,
      flowName: "My Flow",
      cron: "30 1 * * *",
      nodeCount: 3,
      existingId: null,
      createdId: null,
    })
    expect(result.applied).toBe(false)
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0].entity).toBe("visual_flow")
    expect(result.changes[0].field).toBe("created")
    expect(result.changes[0].id).toBe("(new)")
    expect(result.summary).toMatch(/Would create/)
    expect(result.summary).toContain("My Flow")
    expect(result.summary).toContain("30 1 * * *")
    expect(result.summary).toContain("3")
  })

  it("reports created when apply succeeds with a new id", () => {
    const result = summarizeFlowInstall({
      jobId: "jid",
      dry_run: false,
      flowName: "My Flow",
      cron: "30 1 * * *",
      nodeCount: 3,
      existingId: null,
      createdId: "vf_new",
    })
    expect(result.applied).toBe(true)
    expect(result.changes[0].id).toBe("vf_new")
    expect(result.summary).toMatch(/Created/)
    expect(result.summary).toContain("vf_new")
  })

  it("reports not applied when createdId is null on apply", () => {
    const result = summarizeFlowInstall({
      jobId: "jid",
      dry_run: false,
      flowName: "My Flow",
      cron: "30 1 * * *",
      nodeCount: 3,
      existingId: null,
      createdId: null,
    })
    expect(result.applied).toBe(false)
    expect(result.changes[0].id).toBe("(new)")
  })
})
