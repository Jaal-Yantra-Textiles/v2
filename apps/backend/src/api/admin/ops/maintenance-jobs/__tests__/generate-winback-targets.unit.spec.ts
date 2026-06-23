import {
  buildWinbackResult,
  generateWinbackTargetsJob,
} from "../registry"
import type { WinbackSelection } from "../../../../../modules/marketing/winback-targets-lib"

/**
 * #659 §12.5 — unit tests for the winback job's pure result builder + the job
 * descriptor. No DB / ad_planning: we feed a fabricated selection and assert the
 * dry-run vs apply reporting, the per-target change set, and the `applied` flag.
 */

const selection = (
  over: Partial<WinbackSelection> = {}
): WinbackSelection => ({
  targets: [
    { person_id: "p1", email: "a@x.com", name: "A", churn_risk: 90, clv: 5000 },
    { person_id: "p2", email: "b@x.com", name: null, churn_risk: 80, clv: null },
  ],
  skipped: [
    { person_id: "p3", reason: "no_email", churn_risk: 85 },
    { person_id: "p4", reason: "already_targeted", churn_risk: 95 },
  ],
  stats: { scanned: 10, qualified: 2, targeted: 2, skipped: 2, capped: 0 },
  ...over,
})

describe("buildWinbackResult", () => {
  it("dry-run: previews would-create targets and is NOT applied", () => {
    const r = buildWinbackResult("job", true, selection(), 0)
    expect(r.dry_run).toBe(true)
    expect(r.applied).toBe(false)
    expect(r.changes).toHaveLength(2)
    expect(r.changes[0].entity).toBe("marketing_outreach")
    expect((r.changes[0].after as any).status).toBe("(would create)")
    expect(r.summary).toContain("Dry-run")
    expect(r.summary).toContain("Skipped 2")
    expect(r.summary).toMatch(/no_email=1/)
    expect(r.summary).toMatch(/already_targeted=1/)
  })

  it("apply: reports created rows and is applied when createdCount > 0", () => {
    const r = buildWinbackResult("job", false, selection(), 2)
    expect(r.applied).toBe(true)
    expect((r.changes[0].after as any).status).toBe("queued")
    expect(r.summary).toContain("Created 2 winback outreach row")
  })

  it("apply with zero created is not applied", () => {
    const r = buildWinbackResult(
      "job",
      false,
      selection({ targets: [], stats: { scanned: 5, qualified: 0, targeted: 0, skipped: 5, capped: 0 } }),
      0
    )
    expect(r.applied).toBe(false)
  })

  it("notes the cap overflow", () => {
    const r = buildWinbackResult(
      "job",
      true,
      selection({ stats: { scanned: 10, qualified: 5, targeted: 2, skipped: 2, capped: 3 } }),
      0
    )
    expect(r.summary).toContain("3 over the cap")
  })
})

describe("generateWinbackTargetsJob", () => {
  it("is a well-formed maintenance job", () => {
    expect(generateWinbackTargetsJob.id).toBe("generate-winback-targets")
    expect(generateWinbackTargetsJob.params.map((p) => p.name)).toEqual([
      "min_churn_risk",
      "min_clv",
      "max_targets",
    ])
    expect(generateWinbackTargetsJob.params.every((p) => !p.required)).toBe(true)
  })
})
