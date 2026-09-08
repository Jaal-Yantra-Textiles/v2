import {
  derivePartnerEngagement,
  isRunOwnedByPartner,
  partnerRunsForDesign,
} from "../partner-design-engagement"
import { buildPartnerDesignView } from "../list-partner-designs"

/**
 * Fixture: partner Sharlho as production actually has them (2026-09).
 * 34 linked designs, 18 with no run of their own. The two named designs below
 * are the real rows that make the distinction load-bearing:
 *
 *  - `Lhamho Jacket`  — HAS a run, but the run is `execution_mode: in_house`
 *                       with `partner_id: null`. The work went in-house; the
 *                       link row stayed. This must NOT read as assigned.
 *  - `Butterfly shirt`— Superseded, linked, no run at all → shared.
 */
const SHARLHO = "01K4PJMNMNRGMK0ZXMKBBDZDGD"
const OTHER_PARTNER = "01K0000000OTHERPARTNER000"

const design = (id: string, over: Record<string, any> = {}) => ({
  id,
  name: over.name ?? "Untitled",
  status: over.status ?? "Conceptual",
  owner_partner_id: over.owner_partner_id ?? null,
  tasks: [],
  ...over,
})

const run = (over: Record<string, any> = {}) => ({
  id: over.id ?? "prun_1",
  design_id: over.design_id ?? null,
  partner_id: over.partner_id ?? null,
  execution_mode: over.execution_mode ?? "outsourced",
  sub_partner_id: over.sub_partner_id ?? null,
  status: over.status ?? "in_progress",
  created_at: over.created_at ?? "2026-05-01T00:00:00.000Z",
  ...over,
})

// The real prod rows.
const LHAMHO_JACKET = "01K5RGXG0WZN3W47A1HCTW5HR6"
const BUTTERFLY_SHIRT = "01K5RH3VYKQBQSWR54EHNFERD2"
const ASSIGNED_DESIGN = "01K5ASSIGNEDDESIGN0000000"
const OWNED_DESIGN = "01K5OWNEDBYSHARLHO0000000"

describe("isRunOwnedByPartner", () => {
  it("counts a run whose partner_id is the partner", () => {
    expect(isRunOwnedByPartner(run({ partner_id: SHARLHO }), SHARLHO)).toBe(true)
  })

  it("does NOT count an in-house run with a null partner_id (Lhamho Jacket)", () => {
    expect(
      isRunOwnedByPartner(
        run({
          design_id: LHAMHO_JACKET,
          partner_id: null,
          execution_mode: "in_house",
        }),
        SHARLHO
      )
    ).toBe(false)
  })

  it("does NOT count another partner's run", () => {
    expect(isRunOwnedByPartner(run({ partner_id: OTHER_PARTNER }), SHARLHO)).toBe(false)
  })

  it("does NOT count a run merely outsourced TO the partner via sub_partner_id", () => {
    // Deliberate: the listing never fetches sub-partner runs, and every other
    // partner-facing derivation keys on partner_id. See the module docblock.
    expect(
      isRunOwnedByPartner(
        run({ partner_id: OTHER_PARTNER, execution_mode: "outsourced", sub_partner_id: SHARLHO }),
        SHARLHO
      )
    ).toBe(false)
  })

  it("treats an ABSENT partner_id key as the partner's own run, unlike an explicit null", () => {
    // The listing reads runs already filtered by partner_id. If the column were
    // ever dropped from the field list, an absent key must not silently turn
    // every design "shared" — while an explicit null (in-house) still must not
    // count. undefined !== null.
    expect(isRunOwnedByPartner({ design_id: "d1" }, SHARLHO)).toBe(true)
    expect(isRunOwnedByPartner({ design_id: "d1", partner_id: null }, SHARLHO)).toBe(false)
  })

  it("does not treat an empty-string partner_id as a match", () => {
    expect(isRunOwnedByPartner(run({ partner_id: "" }), SHARLHO)).toBe(false)
    expect(isRunOwnedByPartner(run({ partner_id: null }), "")).toBe(false)
  })
})

describe("partnerRunsForDesign", () => {
  const runs = [
    run({ id: "r_inhouse", design_id: LHAMHO_JACKET, partner_id: null, execution_mode: "in_house" }),
    run({ id: "r_mine", design_id: ASSIGNED_DESIGN, partner_id: SHARLHO }),
    run({ id: "r_other", design_id: ASSIGNED_DESIGN, partner_id: OTHER_PARTNER }),
  ]

  it("returns only this partner's runs for the design", () => {
    expect(partnerRunsForDesign(runs, ASSIGNED_DESIGN, SHARLHO).map((r) => r.id)).toEqual([
      "r_mine",
    ])
  })

  it("returns nothing for a design whose only run went in-house", () => {
    expect(partnerRunsForDesign(runs, LHAMHO_JACKET, SHARLHO)).toEqual([])
  })

  it("does not cross designs", () => {
    expect(partnerRunsForDesign(runs, BUTTERFLY_SHIRT, SHARLHO)).toEqual([])
  })
})

describe("derivePartnerEngagement", () => {
  const runs = [
    run({ id: "r_inhouse", design_id: LHAMHO_JACKET, partner_id: null, execution_mode: "in_house" }),
    run({ id: "r_mine", design_id: ASSIGNED_DESIGN, partner_id: SHARLHO }),
    run({ id: "r_other", design_id: ASSIGNED_DESIGN, partner_id: OTHER_PARTNER }),
  ]

  it("assigned: the partner holds a run on the design", () => {
    expect(derivePartnerEngagement(design(ASSIGNED_DESIGN), SHARLHO, runs)).toEqual({
      engagement: "assigned",
      has_partner_run: true,
      partner_run_count: 1,
    })
  })

  it("shared: linked only, no run at all (Butterfly shirt, Superseded)", () => {
    expect(
      derivePartnerEngagement(design(BUTTERFLY_SHIRT, { status: "Superseded" }), SHARLHO, runs)
    ).toEqual({ engagement: "shared", has_partner_run: false, partner_run_count: 0 })
  })

  it("shared: the run on this design went in-house (Lhamho Jacket)", () => {
    // The failure this whole change exists to prevent: a run EXISTS on the
    // design, so a naive `runs.some(r => r.design_id === id)` says assigned.
    expect(derivePartnerEngagement(design(LHAMHO_JACKET), SHARLHO, runs)).toEqual({
      engagement: "shared",
      has_partner_run: false,
      partner_run_count: 0,
    })
  })

  it("owned: the partner created it — never 'shared with you'", () => {
    expect(
      derivePartnerEngagement(
        design(OWNED_DESIGN, { owner_partner_id: SHARLHO }),
        SHARLHO,
        runs
      )
    ).toEqual({ engagement: "owned", has_partner_run: false, partner_run_count: 0 })
  })

  it("owned AND run: ownership labels it, the run fact is reported separately", () => {
    const owned = design(OWNED_DESIGN, { owner_partner_id: SHARLHO })
    expect(
      derivePartnerEngagement(owned, SHARLHO, [
        ...runs,
        run({ id: "r_owned", design_id: OWNED_DESIGN, partner_id: SHARLHO }),
      ])
    ).toEqual({ engagement: "owned", has_partner_run: true, partner_run_count: 1 })
  })

  it("a design owned by ANOTHER partner but assigned to this one is assigned, not owned", () => {
    expect(
      derivePartnerEngagement(
        design(ASSIGNED_DESIGN, { owner_partner_id: OTHER_PARTNER }),
        SHARLHO,
        runs
      ).engagement
    ).toBe("assigned")
  })
})

describe("buildPartnerDesignView exposes the engagement on the response", () => {
  const runs = [
    run({ id: "r_inhouse", design_id: LHAMHO_JACKET, partner_id: null, execution_mode: "in_house" }),
    run({ id: "r_mine", design_id: ASSIGNED_DESIGN, partner_id: SHARLHO, status: "in_progress", started_at: "2026-05-02T00:00:00.000Z" }),
  ]

  const view = (d: any) =>
    buildPartnerDesignView({ design: d, partner: { id: SHARLHO } }, SHARLHO, runs) as any

  it("labels an assigned design and keeps its lifecycle status", () => {
    const v = view(design(ASSIGNED_DESIGN))
    expect(v.partner_engagement).toBe("assigned")
    expect(v.has_partner_run).toBe(true)
    expect(v.partner_info.partner_status).toBe("in_progress")
  })

  it("labels the in-house design shared AND leaves it 'incoming', not in_progress", () => {
    const v = view(design(LHAMHO_JACKET))
    expect(v.partner_engagement).toBe("shared")
    expect(v.has_partner_run).toBe(false)
    // The in-house run must not drive this partner's lifecycle either.
    expect(v.partner_info.partner_status).toBe("incoming")
  })

  it("labels a self-created design owned, with is_owner still true", () => {
    const v = view(design(OWNED_DESIGN, { owner_partner_id: SHARLHO }))
    expect(v.partner_engagement).toBe("owned")
    expect(v.is_owner).toBe(true)
  })

  it("keeps is_owner false for a design owned by another partner", () => {
    const v = view(design(ASSIGNED_DESIGN, { owner_partner_id: OTHER_PARTNER }))
    expect(v.is_owner).toBe(false)
    expect(v.partner_engagement).toBe("assigned")
  })
})
