import {
  classifyExtraPartnerRegionLinks,
  getMaintenanceJob,
  missingPartnerRegionPairs,
  propagateRegionsToAllPartnersJob,
} from "../registry"

/**
 * #2062 — regions that never reached the partners created after them.
 *
 * `region.created` fans a new region out to every partner. Nothing went the
 * other way, so a partner created AFTER a region never gained that region's
 * link — permanently. Prod on 2026-09-14: India and America 21/30, Israel
 * 22/30, Indonesia and Australia 27/30. The shortfall maps onto region age.
 */
describe("missingPartnerRegionPairs (#2062)", () => {
  it("finds every unlinked (partner, region) pair", () => {
    expect(
      missingPartnerRegionPairs(["p1", "p2"], ["r1"], [{ partner_id: "p1", region_id: "r1" }])
    ).toEqual([{ partner_id: "p2", region_id: "r1" }])
  })

  it("returns nothing when everything is linked", () => {
    expect(
      missingPartnerRegionPairs(
        ["p1", "p2"],
        ["r1"],
        [
          { partner_id: "p1", region_id: "r1" },
          { partner_id: "p2", region_id: "r1" },
        ]
      )
    ).toEqual([])
  })

  it("produces the full cross product when nothing is linked", () => {
    expect(missingPartnerRegionPairs(["p1", "p2"], ["r1", "r2"], [])).toHaveLength(4)
  })

  /**
   * An older region is short against MORE partners, because more partners have
   * been created since. That asymmetry is the whole signature of the bug.
   */
  it("reports an older region as shorter than a newer one", () => {
    const partners = ["p1", "p2", "p3", "p4"]
    const existing = [
      // r_old linked only to the one partner that predated it
      { partner_id: "p1", region_id: "r_old" },
      // r_new linked to everyone alive when it was created
      { partner_id: "p1", region_id: "r_new" },
      { partner_id: "p2", region_id: "r_new" },
      { partner_id: "p3", region_id: "r_new" },
    ]
    const missing = missingPartnerRegionPairs(partners, ["r_old", "r_new"], existing)
    const byRegion = missing.reduce<Record<string, number>>((acc, m) => {
      acc[m.region_id] = (acc[m.region_id] ?? 0) + 1
      return acc
    }, {})
    expect(byRegion["r_old"]).toBe(3)
    expect(byRegion["r_new"]).toBe(1)
  })

  /** A link row missing either side cannot mark a pair as present. */
  it("ignores malformed link rows rather than counting them as linked", () => {
    expect(
      missingPartnerRegionPairs(
        ["p1"],
        ["r1"],
        [{ partner_id: null, region_id: "r1" }, { partner_id: "p1", region_id: null }]
      )
    ).toEqual([{ partner_id: "p1", region_id: "r1" }])
  })

  it("handles empty inputs", () => {
    expect(missingPartnerRegionPairs([], ["r1"], [])).toEqual([])
    expect(missingPartnerRegionPairs(["p1"], [], [])).toEqual([])
  })
})

describe("propagate-regions-to-all-partners", () => {
  const makeContainer = (opts: {
    regions?: any[]
    partners?: any[]
    links?: any[]
  }) => ({
    resolve: () => ({
      graph: async (args: any) => {
        if (args.entity === "region") return { data: opts.regions ?? [] }
        if (args.entity === "partners") return { data: opts.partners ?? [] }
        return { data: opts.links ?? [] }
      },
    }),
  })

  it("is registered so an operator can reach it", () => {
    expect(getMaintenanceJob("propagate-regions-to-all-partners")).toBe(
      propagateRegionsToAllPartnersJob
    )
  })

  it("dry-run lists the missing pairs and writes nothing", async () => {
    const res = await propagateRegionsToAllPartnersJob.run(
      makeContainer({
        regions: [{ id: "r_old", name: "India" }, { id: "r_new", name: "Israel" }],
        partners: [{ id: "p1", name: "Sharlho" }, { id: "p2", name: "Kiyo Beauty" }],
        links: [{ partner_id: "p1", region_id: "r_old" }],
      }),
      { dry_run: true, params: {} }
    )
    expect(res.applied).toBe(false)
    // p2→r_old, p1→r_new, p2→r_new
    expect(res.changes).toHaveLength(3)
    expect(res.summary).toMatch(/Would create 3 partner→region link\(s\)/)
    // The note must name the partner and region, not just ids.
    expect(res.changes[0].note).toMatch(/→ region "/)
  })

  it("reports nothing to do when every pair is already linked", async () => {
    const res = await propagateRegionsToAllPartnersJob.run(
      makeContainer({
        regions: [{ id: "r1", name: "India" }],
        partners: [{ id: "p1", name: "Sharlho" }],
        links: [{ partner_id: "p1", region_id: "r1" }],
      }),
      { dry_run: true, params: {} }
    )
    expect(res.changes).toHaveLength(0)
    expect(res.summary).toMatch(/Would create 0 partner→region link\(s\)/)
  })

  it("does nothing when there are no regions or no partners", async () => {
    const noRegions = await propagateRegionsToAllPartnersJob.run(
      makeContainer({ regions: [], partners: [{ id: "p1" }] }),
      { dry_run: true, params: {} }
    )
    expect(noRegions.applied).toBe(false)
    expect(noRegions.summary).toMatch(/Nothing to do/)

    const noPartners = await propagateRegionsToAllPartnersJob.run(
      makeContainer({ regions: [{ id: "r1" }], partners: [] }),
      { dry_run: true, params: {} }
    )
    expect(noPartners.summary).toMatch(/Nothing to do/)
  })

  it("honours region_ids and partner_ids scoping", async () => {
    const res = await propagateRegionsToAllPartnersJob.run(
      makeContainer({
        regions: [{ id: "r1", name: "India" }, { id: "r2", name: "Israel" }],
        partners: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
        links: [],
      }),
      { dry_run: true, params: { region_ids: "r1", partner_ids: "p2" } }
    )
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0].after).toEqual({ partner_id: "p2", region_id: "r1" })
  })
})

/**
 * The other direction: a region with MORE links than live partners.
 *
 * 🔴 `Europe reports 31/30` prompted this, and the likeliest answer is that it
 * is not a defect. `deletePartnerWorkflow` SOFT-deletes, so a deleted partner
 * keeps its `partner_region` row — and any count of links against LIVE partners
 * overshoots by one per deleted partner. Correct history, read as a fault.
 */
describe("classifyExtraPartnerRegionLinks (#2062)", () => {
  it("says nothing when every link belongs to a live partner", () => {
    expect(
      classifyExtraPartnerRegionLinks(
        [{ partner_id: "p1", region_id: "r1" }],
        ["p1"],
        []
      )
    ).toEqual([])
  })

  /** The Europe 31/30 hypothesis, stated as a test. */
  it("attributes a surplus link to a SOFT-DELETED partner, not a fault", () => {
    expect(
      classifyExtraPartnerRegionLinks(
        [
          { partner_id: "p_live", region_id: "r_eu" },
          { partner_id: "p_gone", region_id: "r_eu" },
        ],
        ["p_live"],
        ["p_gone"]
      )
    ).toEqual([{ partner_id: "p_gone", region_id: "r_eu", kind: "deleted_partner" }])
  })

  it("separates a genuinely dangling link from a deleted one", () => {
    expect(
      classifyExtraPartnerRegionLinks(
        [{ partner_id: "p_ghost", region_id: "r1" }],
        ["p_live"],
        ["p_gone"]
      )
    ).toEqual([{ partner_id: "p_ghost", region_id: "r1", kind: "unknown_partner" }])
  })

  it("flags a duplicate row for a pair that is already linked", () => {
    const out = classifyExtraPartnerRegionLinks(
      [
        { partner_id: "p1", region_id: "r1" },
        { partner_id: "p1", region_id: "r1" },
      ],
      ["p1"],
      []
    )
    expect(out).toEqual([{ partner_id: "p1", region_id: "r1", kind: "duplicate" }])
  })

  /**
   * A duplicate row for a DELETED partner is still a duplicate — the first row
   * is already accounted for, so the second is surplus regardless of who owns it.
   */
  it("calls the second row of a deleted partner a duplicate, not a second deletion", () => {
    const out = classifyExtraPartnerRegionLinks(
      [
        { partner_id: "p_gone", region_id: "r1" },
        { partner_id: "p_gone", region_id: "r1" },
      ],
      [],
      ["p_gone"]
    )
    expect(out.map((x) => x.kind)).toEqual(["deleted_partner", "duplicate"])
  })

  it("ignores malformed rows", () => {
    expect(
      classifyExtraPartnerRegionLinks(
        [{ partner_id: null, region_id: "r1" }, { partner_id: "p1", region_id: null }],
        [],
        []
      )
    ).toEqual([])
  })
})

describe("propagate-regions-to-all-partners — surplus link reporting", () => {
  const makeContainer = (opts: any) => ({
    resolve: () => ({
      graph: async (args: any) => {
        if (args.entity === "region") return { data: opts.regions ?? [] }
        if (args.entity === "partners") {
          return { data: args.withDeleted ? opts.allPartners ?? [] : opts.partners ?? [] }
        }
        return { data: opts.links ?? [] }
      },
    }),
  })

  it("explains a 31/30 as a deleted partner rather than reporting a fault", async () => {
    const res = await propagateRegionsToAllPartnersJob.run(
      makeContainer({
        regions: [{ id: "r_eu", name: "Europe" }],
        partners: [{ id: "p_live", name: "Sharlho" }],
        allPartners: [
          { id: "p_live", name: "Sharlho", deleted_at: null },
          { id: "p_gone", name: "Old Partner", deleted_at: "2026-01-01" },
        ],
        links: [
          { partner_id: "p_live", region_id: "r_eu" },
          { partner_id: "p_gone", region_id: "r_eu" },
        ],
      }),
      { dry_run: true, params: {} }
    )
    expect(res.summary).toMatch(/1 surplus link\(s\)/)
    expect(res.summary).toMatch(/1 deleted_partner/)
    expect(res.summary).toMatch(/Reported only; nothing is removed/)
    const extra = res.changes.find((c) => c.field === "extra_link")
    expect(extra?.note).toMatch(/correct history, not a fault/)
  })

  it("says nothing about surplus when there is none", async () => {
    const res = await propagateRegionsToAllPartnersJob.run(
      makeContainer({
        regions: [{ id: "r1", name: "India" }],
        partners: [{ id: "p1", name: "A" }],
        allPartners: [{ id: "p1", name: "A", deleted_at: null }],
        links: [{ partner_id: "p1", region_id: "r1" }],
      }),
      { dry_run: true, params: {} }
    )
    expect(res.summary).not.toMatch(/surplus/)
    expect(res.changes.filter((c) => c.field === "extra_link")).toHaveLength(0)
  })
})
