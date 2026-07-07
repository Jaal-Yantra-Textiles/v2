import {
  applyDesignListFilters,
  computeBucketFacets,
  matchesBucket,
} from "../list-filters"

const make = (
  over: Partial<{
    id: string
    name: string
    status: string
    partner_status: string
    owner_partner_id: string | null
  }> = {}
) => ({
  id: over.id ?? "design_1",
  name: over.name ?? "Untitled",
  status: over.status ?? "Conceptual",
  owner_partner_id: over.owner_partner_id ?? null,
  partner_info: { partner_status: over.partner_status ?? "incoming" },
})

describe("applyDesignListFilters (#484 partner designs search)", () => {
  const designs = [
    make({ id: "design_alpha", name: "Summer Kurta", status: "Approved" }),
    make({ id: "design_beta", name: "Winter Coat", status: "Conceptual" }),
    make({ id: "design_gamma", name: "Summer Dress", status: "Approved" }),
  ]

  it("returns all designs when no q/status given", () => {
    const { items, count } = applyDesignListFilters(designs, {})
    expect(count).toBe(3)
    expect(items).toHaveLength(3)
  })

  it("filters by free-text q on name (case-insensitive)", () => {
    const { items, count } = applyDesignListFilters(designs, { q: "SUMMER" })
    expect(count).toBe(2)
    expect(items.map((d) => d.id)).toEqual(["design_alpha", "design_gamma"])
  })

  it("filters by q on id", () => {
    const { items, count } = applyDesignListFilters(designs, { q: "beta" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("design_beta")
  })

  it("filters by q on status text", () => {
    const { items, count } = applyDesignListFilters(designs, { q: "approved" })
    expect(count).toBe(2)
  })

  it("non-matching q yields an empty set (the bug: used to return everything)", () => {
    const { items, count } = applyDesignListFilters(designs, { q: "no-such-thing" })
    expect(count).toBe(0)
    expect(items).toHaveLength(0)
  })

  it("status filter is exact and combines with q", () => {
    const { items, count } = applyDesignListFilters(designs, {
      status: "Approved",
      q: "summer",
    })
    expect(count).toBe(2)
    expect(items.map((d) => d.id)).toEqual(["design_alpha", "design_gamma"])
  })

  it("status filter alone returns only exact matches", () => {
    const { items, count } = applyDesignListFilters(designs, { status: "Conceptual" })
    expect(count).toBe(1)
    expect(items[0].id).toBe("design_beta")
  })

  it("paginates AFTER filtering and reports total matched count (page-vs-set bug)", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      make({ id: `design_${i}`, name: `Kurta ${i}`, status: "Approved" })
    )
    const { items, count } = applyDesignListFilters(many, {
      q: "kurta",
      offset: 20,
      limit: 20,
    })
    // 25 match, page 2 (offset 20) returns the last 5, count is the full 25.
    expect(count).toBe(25)
    expect(items).toHaveLength(5)
    expect(items[0].id).toBe("design_20")
  })

  it("falls back to safe defaults for invalid offset/limit", () => {
    const { items, count } = applyDesignListFilters(designs, {
      offset: -5 as any,
      limit: 0 as any,
    })
    expect(count).toBe(3)
    expect(items).toHaveLength(3)
  })
})

describe("design work buckets (#6 partner tabs)", () => {
  const set = [
    make({ id: "d_inc", partner_status: "incoming" }),
    make({ id: "d_assigned", partner_status: "assigned" }),
    make({ id: "d_prog", partner_status: "in_progress" }),
    make({ id: "d_review", partner_status: "awaiting_review" }),
    make({ id: "d_fin", partner_status: "finished" }),
    make({ id: "d_done", partner_status: "completed" }),
    // Owned design that's also in progress — counts for BOTH yours + in_progress.
    make({ id: "d_own", partner_status: "in_progress", owner_partner_id: "partner_1" }),
  ]

  it("matchesBucket collapses the partner_status lifecycle", () => {
    expect(matchesBucket(make({ partner_status: "assigned" }), "incoming")).toBe(true)
    expect(matchesBucket(make({ partner_status: "awaiting_review" }), "in_progress")).toBe(true)
    expect(matchesBucket(make({ partner_status: "finished" }), "completed")).toBe(true)
    expect(matchesBucket(make({ partner_status: "incoming" }), "completed")).toBe(false)
  })

  it("yours keys on ownership regardless of status", () => {
    expect(matchesBucket(make({ owner_partner_id: "p" }), "yours")).toBe(true)
    expect(matchesBucket(make({ owner_partner_id: null }), "yours")).toBe(false)
  })

  it("computes facet counts over the full set (yours cross-cuts status)", () => {
    expect(computeBucketFacets(set)).toEqual({
      all: 7,
      incoming: 2, // d_inc, d_assigned
      in_progress: 3, // d_prog, d_review, d_own
      completed: 2, // d_fin, d_done
      yours: 1, // d_own
    })
  })

  it("narrows items to the active bucket but keeps facets over the full set", () => {
    const { items, count, facets } = applyDesignListFilters(set, { bucket: "incoming" })
    expect(count).toBe(2)
    expect(items.map((d) => d.id)).toEqual(["d_inc", "d_assigned"])
    // Facets reflect the whole set, not just the active tab.
    expect(facets.in_progress).toBe(3)
    expect(facets.all).toBe(7)
  })

  it("bucket=all is a no-op narrowing", () => {
    const { count } = applyDesignListFilters(set, { bucket: "all" })
    expect(count).toBe(7)
  })
})
