import { findKitBatchOwnershipProblem, KitBatchOwnershipInput } from "../ownership"
import { PartnerBatchVariantInventoryItemsSchema } from "../validators"

const base = (): KitBatchOwnershipInput => ({
  product: { variantIds: ["variant_pack"], salesChannelIds: ["sc_gof"] },
  storeSalesChannelId: "sc_gof",
  storeLocationIds: ["sloc_gof"],
  items: [{ id: "iitem_metre", locationIds: ["sloc_gof"] }],
  rows: [{ variant_id: "variant_pack", inventory_item_id: "iitem_metre" }],
})

describe("partner kit batch ownership", () => {
  it("lets a partner tie their own pack to their own per-metre stock", () => {
    expect(findKitBatchOwnershipProblem(base())).toBeNull()
  })

  it("refuses a product outside the partner's store", () => {
    const input = base()
    input.product!.salesChannelIds = ["sc_someone_else"]
    expect(findKitBatchOwnershipProblem(input)).toBe("Product not found")
    expect(findKitBatchOwnershipProblem({ ...base(), product: null })).toBe("Product not found")
    expect(findKitBatchOwnershipProblem({ ...base(), storeSalesChannelId: null })).toBe("Product not found")
  })

  it("refuses a variant that belongs to another product", () => {
    const input = base()
    input.rows = [{ variant_id: "variant_other", inventory_item_id: "iitem_metre" }]
    expect(findKitBatchOwnershipProblem(input)).toMatch(/variant_other/)
  })

  it("refuses another partner's stock item, and one that does not exist", () => {
    const theirs = base()
    theirs.items = [{ id: "iitem_metre", locationIds: ["sloc_other_partner"] }]
    expect(findKitBatchOwnershipProblem(theirs)).toMatch(/iitem_metre/)

    const missing = base()
    missing.items = []
    expect(findKitBatchOwnershipProblem(missing)).toMatch(/iitem_metre/)
  })

  it("refuses a zero or negative required_quantity", () => {
    const row = { variant_id: "v", inventory_item_id: "i" }
    expect(PartnerBatchVariantInventoryItemsSchema.safeParse({ create: [{ ...row, required_quantity: 12 }] }).success).toBe(true)
    expect(PartnerBatchVariantInventoryItemsSchema.safeParse({ create: [{ ...row, required_quantity: 0 }] }).success).toBe(false)
    expect(PartnerBatchVariantInventoryItemsSchema.safeParse({ update: [{ ...row, required_quantity: -12 }] }).success).toBe(false)
  })
})
