import {
  selectWinbackTargets,
  type ChurnScoreRow,
  type PersonContact,
} from "../winback-targets-lib"

/**
 * #659 §12.5 — unit tests for the pure winback selector: threshold, optional CLV
 * floor, dedup, idempotency, cap + highest-risk-first ordering, and the
 * skipped-reason accounting for scored buyers with no Person / no email.
 */

const contacts = (
  rows: Array<[string, string | null, string | null]>
): Map<string, PersonContact> =>
  new Map(rows.map(([id, email, name]) => [id, { id, email, name }]))

describe("selectWinbackTargets", () => {
  it("targets only persons at/above the churn threshold, highest-risk first", () => {
    const scores: ChurnScoreRow[] = [
      { person_id: "p1", score_value: 60 },
      { person_id: "p2", score_value: 90 },
      { person_id: "p3", score_value: 75 },
    ]
    const sel = selectWinbackTargets(
      scores,
      contacts([
        ["p1", "p1@x.com", "One"],
        ["p2", "p2@x.com", "Two"],
        ["p3", "p3@x.com", "Three"],
      ]),
      undefined,
      new Set(),
      { minChurnRisk: 70 }
    )
    expect(sel.targets.map((t) => t.person_id)).toEqual(["p2", "p3"])
    expect(sel.targets[0].email).toBe("p2@x.com")
    expect(sel.skipped).toEqual([
      { person_id: "p1", reason: "below_threshold", churn_risk: 60 },
    ])
    expect(sel.stats).toMatchObject({ scanned: 3, qualified: 2, targeted: 2 })
  })

  it("skips scored buyers with no Person row or no email (never crashes)", () => {
    const scores: ChurnScoreRow[] = [
      { person_id: "p1", score_value: 90 },
      { person_id: "p2", score_value: 85 },
      { person_id: "p3", score_value: 80 },
    ]
    const sel = selectWinbackTargets(
      scores,
      contacts([
        ["p1", "p1@x.com", "One"],
        // p2 has a Person but no email
        ["p2", "", "Two"],
        // p3 has NO Person row at all
      ]),
      undefined,
      new Set(),
      { minChurnRisk: 70 }
    )
    expect(sel.targets.map((t) => t.person_id)).toEqual(["p1"])
    const reasons = Object.fromEntries(
      sel.skipped.map((s) => [s.person_id, s.reason])
    )
    expect(reasons).toEqual({ p2: "no_email", p3: "no_person" })
  })

  it("is idempotent — already-targeted emails (case-insensitive) are skipped", () => {
    const scores: ChurnScoreRow[] = [{ person_id: "p1", score_value: 90 }]
    const sel = selectWinbackTargets(
      scores,
      contacts([["p1", "P1@X.com", "One"]]),
      undefined,
      new Set(["p1@x.com"]),
      { minChurnRisk: 70 }
    )
    expect(sel.targets).toHaveLength(0)
    expect(sel.skipped[0]).toEqual({
      person_id: "p1",
      reason: "already_targeted",
      churn_risk: 90,
    })
  })

  it("applies an optional CLV floor", () => {
    const scores: ChurnScoreRow[] = [
      { person_id: "p1", score_value: 90 },
      { person_id: "p2", score_value: 90 },
    ]
    const clv = new Map([
      ["p1", 5000],
      ["p2", 100],
    ])
    const sel = selectWinbackTargets(
      scores,
      contacts([
        ["p1", "p1@x.com", "One"],
        ["p2", "p2@x.com", "Two"],
      ]),
      clv,
      new Set(),
      { minChurnRisk: 70, minClv: 1000 }
    )
    expect(sel.targets.map((t) => t.person_id)).toEqual(["p1"])
    expect(sel.targets[0].clv).toBe(5000)
    expect(sel.skipped[0]).toMatchObject({ person_id: "p2", reason: "clv_below" })
  })

  it("caps to max targets and counts the overflow", () => {
    const scores: ChurnScoreRow[] = [
      { person_id: "p1", score_value: 95 },
      { person_id: "p2", score_value: 90 },
      { person_id: "p3", score_value: 85 },
    ]
    const sel = selectWinbackTargets(
      scores,
      contacts([
        ["p1", "p1@x.com", "1"],
        ["p2", "p2@x.com", "2"],
        ["p3", "p3@x.com", "3"],
      ]),
      undefined,
      new Set(),
      { minChurnRisk: 70, cap: 2 }
    )
    expect(sel.targets.map((t) => t.person_id)).toEqual(["p1", "p2"])
    expect(sel.stats.capped).toBe(1)
    expect(sel.stats.qualified).toBe(3)
  })

  it("dedups duplicate person_id score rows (keeps the first)", () => {
    const scores: ChurnScoreRow[] = [
      { person_id: "p1", score_value: 90 },
      { person_id: "p1", score_value: 80 },
    ]
    const sel = selectWinbackTargets(
      scores,
      contacts([["p1", "p1@x.com", "One"]]),
      undefined,
      new Set(),
      { minChurnRisk: 70 }
    )
    expect(sel.targets).toHaveLength(1)
    expect(sel.targets[0].churn_risk).toBe(90)
  })
})
