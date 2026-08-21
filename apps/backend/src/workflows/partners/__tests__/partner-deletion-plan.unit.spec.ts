import { planPartnerDeletion, type PartnerDeletionFacts } from "../lib/partner-deletion-plan"

/**
 * The partner-deletion cascade policy.
 *
 * Before this existed, deleting a partner soft-deleted the partner and its
 * admins and nothing else — the store, its sales channel, its publishable key
 * and its products all survived. That is how the orphan store behind the
 * 2026-08-21 platform-wide storefront outage came to exist.
 */

const facts = (over: Partial<PartnerDeletionFacts> = {}): PartnerDeletionFacts => ({
  partner_id: "part_1",
  partner_name: "Unique Pashmina",
  store_ids: ["store_1"],
  sales_channel_ids: ["sc_1"],
  publishable_keys: [{ id: "apk_1", sales_channel_ids: ["sc_1"] }],
  product_ids: ["prod_1", "prod_2"],
  live_order_ids: [],
  force: false,
  ...over,
})

describe("planPartnerDeletion", () => {
  it("takes the store, its channel and its products with the partner", () => {
    const plan = planPartnerDeletion(facts())

    expect(plan.deletable).toBe(true)
    expect(plan.soft_delete_store_ids).toEqual(["store_1"])
    expect(plan.soft_delete_sales_channel_ids).toEqual(["sc_1"])
    expect(plan.soft_delete_product_ids).toEqual(["prod_1", "prod_2"])
  })

  it("unlinks the publishable key rather than deleting or revoking it", () => {
    // Revoking is a one-way door (UpdateApiKeyDTO carries only `title`), and a
    // reversible deletion cannot contain an irreversible step. Deleting the row
    // would lose the token the storefront is configured with.
    const plan = planPartnerDeletion(facts())

    expect(plan.unlink_keys).toEqual([
      { key_id: "apk_1", sales_channel_ids: ["sc_1"] },
    ])
    expect(plan.preserved.join(" ")).toContain("SAME token")
  })

  it("leaves another tenant's channel link on a shared key alone", () => {
    const plan = planPartnerDeletion(
      facts({
        publishable_keys: [
          { id: "apk_shared", sales_channel_ids: ["sc_1", "sc_other"] },
        ],
      })
    )

    expect(plan.unlink_keys).toEqual([
      { key_id: "apk_shared", sales_channel_ids: ["sc_1"] },
    ])
  })

  it("ignores keys that touch none of this partner's channels", () => {
    const plan = planPartnerDeletion(
      facts({ publishable_keys: [{ id: "apk_2", sales_channel_ids: ["sc_other"] }] })
    )

    expect(plan.unlink_keys).toEqual([])
  })

  it("refuses a partner with orders still in flight", () => {
    const plan = planPartnerDeletion(facts({ live_order_ids: ["order_9"] }))

    expect(plan.deletable).toBe(false)
    expect(plan.blockers.join(" ")).toContain("order_9")
  })

  it("carries NO actions on a refusal", () => {
    // A caller must not be able to read `soft_delete_*` off a blocked plan and
    // act on it anyway.
    const plan = planPartnerDeletion(facts({ live_order_ids: ["order_9"] }))

    expect(plan.unlink_keys).toEqual([])
    expect(plan.soft_delete_store_ids).toEqual([])
    expect(plan.soft_delete_sales_channel_ids).toEqual([])
    expect(plan.soft_delete_product_ids).toEqual([])
  })

  it("names every live order it is refusing on, up to five", () => {
    const ids = ["o1", "o2", "o3", "o4", "o5", "o6"]
    const plan = planPartnerDeletion(facts({ live_order_ids: ids }))

    expect(plan.blockers[0]).toContain("6 order(s)")
    expect(plan.blockers[0]).toContain("o5")
    expect(plan.blockers[0]).toContain("…")
  })

  it("proceeds under force, and says so", () => {
    const plan = planPartnerDeletion(
      facts({ live_order_ids: ["order_9"], force: true })
    )

    expect(plan.deletable).toBe(true)
    expect(plan.preserved.join(" ")).toContain("FORCED")
  })

  it("never plans to touch commercial history, stock or the shared region", () => {
    const preserved = planPartnerDeletion(facts()).preserved.join(" ")

    expect(preserved).toContain("Orders")
    expect(preserved).toContain("Stock location")
    expect(preserved).toContain("region")
  })

  it("handles a partner with no store at all", () => {
    const plan = planPartnerDeletion(
      facts({ store_ids: [], sales_channel_ids: [], publishable_keys: [], product_ids: [] })
    )

    expect(plan.deletable).toBe(true)
    expect(plan.unlink_keys).toEqual([])
    expect(plan.soft_delete_store_ids).toEqual([])
  })
})
