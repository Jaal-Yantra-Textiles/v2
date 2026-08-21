import {
  checkOrphanStoreRestorable,
  type OrphanStoreRestoreFacts,
} from "../restore-orphan-store-job"

/**
 * The undo `delete-orphan-store` never had.
 *
 * It was run on prod without anyone confirming a restore path existed. None
 * did — no `restoreStores` / `restoreSalesChannels` / `restoreStockLocations`
 * call appeared anywhere in the codebase — even though all three deletions are
 * soft and the rows were sitting there with `deleted_at` set the whole time.
 */

const facts = (over: Partial<OrphanStoreRestoreFacts> = {}): OrphanStoreRestoreFacts => ({
  store_id: "store_1",
  store_name: "Sharhlo Store",
  store_exists: true,
  store_deleted: true,
  sales_channel_id: "sc_1",
  sales_channel_deleted: true,
  stock_location_id: "loc_1",
  stock_location_deleted: true,
  linked_key_count: 0,
  ...over,
})

describe("checkOrphanStoreRestorable", () => {
  it("restores a soft-deleted store and its siblings", () => {
    const res = checkOrphanStoreRestorable(facts())

    expect(res.restorable).toBe(true)
    expect(res.blockers).toEqual([])
  })

  it("refuses a store that does not exist at all", () => {
    const res = checkOrphanStoreRestorable(facts({ store_exists: false }))

    expect(res.restorable).toBe(false)
    expect(res.blockers.join(" ")).toContain("does not exist")
  })

  it("refuses a store that is not deleted, rather than no-op'ing on a typo", () => {
    const res = checkOrphanStoreRestorable(facts({ store_deleted: false }))

    expect(res.restorable).toBe(false)
    expect(res.blockers.join(" ")).toContain("not deleted")
  })

  it("stops looking once the store itself is missing", () => {
    // No point reporting sibling warnings about a store that isn't there.
    const res = checkOrphanStoreRestorable(
      facts({ store_exists: false, sales_channel_id: null })
    )

    expect(res.blockers).toHaveLength(1)
    expect(res.warnings).toEqual([])
  })

  it("warns — never blocks — when a sibling is already live", () => {
    // A partial restore is still a restore, and this job exists for incidents.
    const res = checkOrphanStoreRestorable(
      facts({ sales_channel_deleted: false, stock_location_deleted: false })
    )

    expect(res.restorable).toBe(true)
    expect(res.warnings.join(" ")).toContain("already live")
  })

  it("says the publishable key is unrecoverable when none is linked", () => {
    const res = checkOrphanStoreRestorable(facts({ linked_key_count: 0 }))

    expect(res.warnings.join(" ")).toContain("unrecoverable")
    expect(res.warnings.join(" ")).toContain("recreate_publishable_key")
  })

  it("stays quiet about the key when one is still linked", () => {
    const res = checkOrphanStoreRestorable(facts({ linked_key_count: 1 }))

    expect(res.warnings.join(" ")).not.toContain("unrecoverable")
  })

  it("warns when the store has no channel to restore", () => {
    const res = checkOrphanStoreRestorable(
      facts({ sales_channel_id: null, sales_channel_deleted: false })
    )

    expect(res.restorable).toBe(true)
    expect(res.warnings.join(" ")).toContain("no default sales channel")
  })
})
