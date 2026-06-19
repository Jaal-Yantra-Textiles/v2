import { scopeUsagesToPartner, UsageEntry } from "../[designId]/used-in/scope-usages"

const make = (over: Partial<UsageEntry> = {}): UsageEntry => ({
  id: over.id ?? "dc_1",
  parent_design:
    over.parent_design === undefined
      ? { id: "bundle_1", owner_partner_id: "partner_me" }
      : over.parent_design,
  ...over,
})

describe("scopeUsagesToPartner (#337 partner design used-in)", () => {
  const ME = "partner_me"

  it("returns only usages whose parent bundle the partner owns", () => {
    const usages = [
      make({ id: "dc1", parent_design: { id: "b1", owner_partner_id: ME } }),
      make({ id: "dc2", parent_design: { id: "b2", owner_partner_id: ME } }),
    ]
    expect(scopeUsagesToPartner(usages, ME).map((u) => u.id)).toEqual([
      "dc1",
      "dc2",
    ])
  })

  it("strips a usage whose parent bundle is admin-owned — no cross-tenant leak", () => {
    const usages = [
      make({ id: "mine", parent_design: { id: "b1", owner_partner_id: ME } }),
      make({
        id: "admin_bundle",
        parent_design: { id: "b2", owner_partner_id: null },
      }),
    ]
    expect(scopeUsagesToPartner(usages, ME).map((u) => u.id)).toEqual(["mine"])
  })

  it("strips a usage whose parent bundle belongs to another partner", () => {
    const usages = [
      make({ id: "mine", parent_design: { id: "b1", owner_partner_id: ME } }),
      make({
        id: "other",
        parent_design: { id: "b2", owner_partner_id: "partner_other" },
      }),
    ]
    expect(scopeUsagesToPartner(usages, ME).map((u) => u.id)).toEqual(["mine"])
  })

  it("drops usages with a missing / unresolved parent_design", () => {
    const usages = [
      make({ id: "mine", parent_design: { id: "b1", owner_partner_id: ME } }),
      make({ id: "no_parent", parent_design: null }),
    ]
    expect(scopeUsagesToPartner(usages, ME).map((u) => u.id)).toEqual(["mine"])
  })

  it("is null/empty safe", () => {
    expect(scopeUsagesToPartner([], ME)).toEqual([])
    expect(
      scopeUsagesToPartner(
        [null as any, make({ id: "ok", parent_design: { owner_partner_id: ME } })],
        ME
      ).map((u) => u.id)
    ).toEqual(["ok"])
  })
})
