import { buildQSearchFilter } from "../list-search-filters"

// Pure unit coverage for the global `q` list-search helper (#525 P1 —
// /admin/partners + /admin/websites). No DB, no container.
describe("buildQSearchFilter (#525 admin list search)", () => {
  it("builds an $or of $ilike clauses across the given fields", () => {
    expect(buildQSearchFilter("acme", ["name", "handle"])).toEqual({
      $or: [
        { name: { $ilike: "%acme%" } },
        { handle: { $ilike: "%acme%" } },
      ],
    })
  })

  it("supports a single field", () => {
    expect(buildQSearchFilter("store", ["domain"])).toEqual({
      $or: [{ domain: { $ilike: "%store%" } }],
    })
  })

  it("trims surrounding whitespace before matching", () => {
    expect(buildQSearchFilter("  acme  ", ["name"])).toEqual({
      $or: [{ name: { $ilike: "%acme%" } }],
    })
  })

  it("returns {} for an undefined term", () => {
    expect(buildQSearchFilter(undefined, ["name", "handle"])).toEqual({})
  })

  it("returns {} for a null term", () => {
    expect(buildQSearchFilter(null, ["name"])).toEqual({})
  })

  it("returns {} for a blank / whitespace-only term", () => {
    expect(buildQSearchFilter("", ["name"])).toEqual({})
    expect(buildQSearchFilter("   ", ["name"])).toEqual({})
  })

  it("returns {} when no fields are supplied", () => {
    expect(buildQSearchFilter("acme", [])).toEqual({})
  })

  it("is spreadable into an existing filters object without clobbering", () => {
    const filters = {
      status: "active",
      ...buildQSearchFilter("foo", ["name", "domain"]),
    }
    expect(filters).toEqual({
      status: "active",
      $or: [
        { name: { $ilike: "%foo%" } },
        { domain: { $ilike: "%foo%" } },
      ],
    })
  })

  it("spreads to nothing when q is absent (leaves base filters intact)", () => {
    const filters = {
      status: "active",
      ...buildQSearchFilter(undefined, ["name"]),
    }
    expect(filters).toEqual({ status: "active" })
  })
})
