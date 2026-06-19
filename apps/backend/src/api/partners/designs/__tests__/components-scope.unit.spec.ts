import {
  scopeComponentsToPartner,
  ComponentEntry,
} from "../[designId]/components/scope-components"

const make = (over: Partial<ComponentEntry> = {}): ComponentEntry => ({
  id: over.id ?? "dc_1",
  component_design:
    over.component_design === undefined
      ? { id: "comp_1", owner_partner_id: "partner_me" }
      : over.component_design,
  ...over,
})

describe("scopeComponentsToPartner (#337 partner design components)", () => {
  const ME = "partner_me"

  it("returns only components the partner owns", () => {
    const components = [
      make({ id: "dc1", component_design: { id: "c1", owner_partner_id: ME } }),
      make({ id: "dc2", component_design: { id: "c2", owner_partner_id: ME } }),
    ]
    expect(scopeComponentsToPartner(components, ME).map((c) => c.id)).toEqual([
      "dc1",
      "dc2",
    ])
  })

  it("strips a component that is an admin-owned design — no cross-tenant leak", () => {
    const components = [
      make({ id: "mine", component_design: { id: "c1", owner_partner_id: ME } }),
      make({
        id: "admin_comp",
        component_design: { id: "c2", owner_partner_id: null },
      }),
    ]
    expect(scopeComponentsToPartner(components, ME).map((c) => c.id)).toEqual([
      "mine",
    ])
  })

  it("strips a component that belongs to another partner", () => {
    const components = [
      make({ id: "mine", component_design: { id: "c1", owner_partner_id: ME } }),
      make({
        id: "other",
        component_design: { id: "c2", owner_partner_id: "partner_other" },
      }),
    ]
    expect(scopeComponentsToPartner(components, ME).map((c) => c.id)).toEqual([
      "mine",
    ])
  })

  it("drops components with a missing / unresolved component_design", () => {
    const components = [
      make({ id: "mine", component_design: { id: "c1", owner_partner_id: ME } }),
      make({ id: "no_comp", component_design: null }),
    ]
    expect(scopeComponentsToPartner(components, ME).map((c) => c.id)).toEqual([
      "mine",
    ])
  })

  it("is null/empty safe", () => {
    expect(scopeComponentsToPartner([], ME)).toEqual([])
    expect(
      scopeComponentsToPartner(
        [
          null as any,
          make({ id: "ok", component_design: { owner_partner_id: ME } }),
        ],
        ME
      ).map((c) => c.id)
    ).toEqual(["ok"])
  })
})
