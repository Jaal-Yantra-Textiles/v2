import { scopeLineageToPartner, LineageEntry } from "../[designId]/revisions/lineage"

const make = (over: Partial<LineageEntry> = {}): LineageEntry => ({
  id: over.id ?? "design_1",
  owner_partner_id: over.owner_partner_id ?? "partner_me",
  revised_from_id: over.revised_from_id ?? null,
  revision_number: over.revision_number ?? 1,
  ...over,
})

describe("scopeLineageToPartner (#337 partner design revisions)", () => {
  const ME = "partner_me"

  it("returns only entries the partner owns, preserving order", () => {
    const full = [
      make({ id: "v1", owner_partner_id: ME, revision_number: 1 }),
      make({
        id: "v2",
        owner_partner_id: ME,
        revision_number: 2,
        revised_from_id: "v1",
      }),
      make({
        id: "v3",
        owner_partner_id: ME,
        revision_number: 3,
        revised_from_id: "v2",
      }),
    ]
    const { lineage, root_design_id } = scopeLineageToPartner(full, ME)
    expect(lineage.map((d) => d.id)).toEqual(["v1", "v2", "v3"])
    expect(root_design_id).toBe("v1")
  })

  it("strips an admin-owned (or other-partner) ancestor — no cross-tenant leak", () => {
    const full = [
      // admin-originated root the partner must NOT see
      make({ id: "admin_root", owner_partner_id: null, revision_number: 1 }),
      make({
        id: "mine_v2",
        owner_partner_id: ME,
        revision_number: 2,
        revised_from_id: "admin_root",
      }),
    ]
    const { lineage, root_design_id } = scopeLineageToPartner(full, ME)
    expect(lineage.map((d) => d.id)).toEqual(["mine_v2"])
    expect(root_design_id).toBe("mine_v2")
  })

  it("strips a descendant owned by another partner", () => {
    const full = [
      make({ id: "mine_v1", owner_partner_id: ME }),
      make({
        id: "other_v2",
        owner_partner_id: "partner_other",
        revised_from_id: "mine_v1",
      }),
    ]
    const { lineage } = scopeLineageToPartner(full, ME)
    expect(lineage.map((d) => d.id)).toEqual(["mine_v1"])
  })

  it("returns empty lineage + null root when the partner owns nothing", () => {
    const full = [make({ id: "admin_only", owner_partner_id: "admin" })]
    const { lineage, root_design_id } = scopeLineageToPartner(full, ME)
    expect(lineage).toEqual([])
    expect(root_design_id).toBeNull()
  })

  it("is null/empty safe", () => {
    expect(scopeLineageToPartner([], ME)).toEqual({
      lineage: [],
      root_design_id: null,
    })
    // tolerate sparse/nullish entries in the walk result
    const { lineage } = scopeLineageToPartner(
      [null as any, make({ id: "ok", owner_partner_id: ME })],
      ME
    )
    expect(lineage.map((d) => d.id)).toEqual(["ok"])
  })
})
