/**
 * The refusal rules for a destructive job, pinned.
 *
 * Everything else in this job is plumbing; the part that matters is which
 * stores it declines to delete. A store cannot be un-deleted, so each of these
 * cases is a real outage avoided rather than a tidy invariant.
 */

import { checkOrphanStoreDeletable, type OrphanStoreFacts } from "../delete-orphan-store-job"

const orphan: OrphanStoreFacts = {
  store_id: "store_stray",
  store_name: "Sharhlo Store",
  has_partner: false,
  product_count: 0,
  order_count: 0,
  stock_level_count: 0,
  sales_channel_id: "sc_stray",
  stock_location_id: "sloc_stray",
  region_id: "reg_shared",
  is_only_unlinked_store: false,
}

describe("checkOrphanStoreDeletable", () => {
  it("allows a genuine orphan", () => {
    expect(checkOrphanStoreDeletable(orphan)).toEqual({
      deletable: true,
      blockers: [],
    })
  })

  it("refuses a store that belongs to a partner", () => {
    const res = checkOrphanStoreDeletable({ ...orphan, has_partner: true })
    expect(res.deletable).toBe(false)
    expect(res.blockers[0]).toContain("linked to a partner")
  })

  it.each([
    ["products", { product_count: 3 }, "product(s)"],
    ["orders", { order_count: 1 }, "order(s)"],
    ["stock", { stock_level_count: 7 }, "inventory level(s)"],
  ])("refuses a store that still has %s", (_label, patch, needle) => {
    const res = checkOrphanStoreDeletable({ ...orphan, ...patch })
    expect(res.deletable).toBe(false)
    expect(res.blockers.join(" ")).toContain(needle)
  })

  it("refuses to delete the LAST unlinked store", () => {
    // The brand store is unlinked by definition. Deleting the only unlinked
    // store turns resolveBrandLocationId's "found 2" throw into "found 0" —
    // the job would have caused the very failure it exists to fix.
    const res = checkOrphanStoreDeletable({
      ...orphan,
      is_only_unlinked_store: true,
    })
    expect(res.deletable).toBe(false)
    expect(res.blockers.join(" ")).toContain("ONLY store without a partner link")
  })

  it("reports every blocker, not just the first", () => {
    // An operator who clears one reason and re-runs should not meet a second.
    const res = checkOrphanStoreDeletable({
      ...orphan,
      has_partner: true,
      product_count: 2,
      order_count: 1,
      stock_level_count: 4,
      is_only_unlinked_store: true,
    })
    expect(res.deletable).toBe(false)
    expect(res.blockers).toHaveLength(5)
  })

  it("does not treat a missing channel or location as a reason to refuse", () => {
    // A half-built store with no channel is exactly the stray worth removing.
    const res = checkOrphanStoreDeletable({
      ...orphan,
      sales_channel_id: null,
      stock_location_id: null,
    })
    expect(res.deletable).toBe(true)
  })

  it("never blocks on the region — it is preserved, not consulted", () => {
    // The shared default region backs ~10 live storefronts. It is never a
    // deletion candidate, so it must not be a deletion blocker either.
    expect(
      checkOrphanStoreDeletable({ ...orphan, region_id: null }).deletable
    ).toBe(true)
  })
})
