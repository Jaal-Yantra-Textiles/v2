import {
  planStorefrontDeletion,
  type StorefrontDeletionFacts,
} from "../lib/storefront-deletion-plan"

/**
 * Deleting a partner's storefront while keeping the partner (#2527).
 */

const facts = (
  over: Partial<StorefrontDeletionFacts> = {}
): StorefrontDeletionFacts => ({
  partner_id: "part_1",
  partner_name: "Zovvy",
  partner_status: "inactive",
  stores: [{ id: "store_1", default_sales_channel_id: "sc_1" }],
  publishable_keys: [
    { id: "apk_1", sales_channel_ids: ["sc_1"] },
    { id: "apk_shared", sales_channel_ids: ["sc_1", "sc_other"] },
  ],
  live_order_ids: [],
  stock_location_ids: ["sloc_1"],
  ...over,
})

describe("planStorefrontDeletion", () => {
  it("takes the store and its channel, never products", () => {
    const plan = planStorefrontDeletion(facts())

    expect(plan.deletable).toBe(true)
    expect(plan.store_id).toBe("store_1")
    expect(plan.soft_delete_store_ids).toEqual(["store_1"])
    expect(plan.soft_delete_sales_channel_ids).toEqual(["sc_1"])
    expect(plan.soft_delete_product_ids).toEqual([])
    expect(plan.dismiss_partner_store).toEqual({
      partner_id: "part_1",
      store_id: "store_1",
    })
  })

  it("unlinks only this store's channel from a shared key", () => {
    const plan = planStorefrontDeletion(facts())

    expect(plan.unlink_keys).toEqual([
      { key_id: "apk_1", sales_channel_ids: ["sc_1"] },
      { key_id: "apk_shared", sales_channel_ids: ["sc_1"] },
    ])
  })

  it("reports the stock location instead of deleting it", () => {
    const plan = planStorefrontDeletion(facts())

    expect(plan.preserved.join(" ")).toContain("sloc_1")
  })

  it("refuses an active partner", () => {
    const plan = planStorefrontDeletion(facts({ partner_status: "active" }))

    expect(plan.deletable).toBe(false)
    expect(plan.blockers.join(" ")).toContain("still active")
    expect(plan.soft_delete_store_ids).toEqual([])
    expect(plan.unlink_keys).toEqual([])
  })

  it("refuses while orders are in flight", () => {
    const plan = planStorefrontDeletion(facts({ live_order_ids: ["order_1"] }))

    expect(plan.deletable).toBe(false)
    expect(plan.blockers.join(" ")).toContain("order_1")
    expect(plan.soft_delete_store_ids).toEqual([])
  })

  it("refuses to guess between several stores", () => {
    const plan = planStorefrontDeletion(
      facts({
        stores: [
          { id: "store_1", default_sales_channel_id: "sc_1" },
          { id: "store_2", default_sales_channel_id: "sc_2" },
        ],
      })
    )

    expect(plan.deletable).toBe(false)
    expect(plan.store_id).toBeNull()
    expect(plan.blockers.join(" ")).toContain("store_2")
  })

  it("refuses a partner with no store", () => {
    const plan = planStorefrontDeletion(facts({ stores: [] }))

    expect(plan.deletable).toBe(false)
    expect(plan.dismiss_partner_store).toBeNull()
  })

  it("deletes a store whose channel is already gone", () => {
    // Zovvy on 2026-11-09: channel deleted by hand, store left behind.
    const plan = planStorefrontDeletion(
      facts({
        stores: [{ id: "store_1", default_sales_channel_id: null }],
        publishable_keys: [],
        stock_location_ids: [],
      })
    )

    expect(plan.deletable).toBe(true)
    expect(plan.soft_delete_store_ids).toEqual(["store_1"])
    expect(plan.soft_delete_sales_channel_ids).toEqual([])
    expect(plan.unlink_keys).toEqual([])
  })
})
