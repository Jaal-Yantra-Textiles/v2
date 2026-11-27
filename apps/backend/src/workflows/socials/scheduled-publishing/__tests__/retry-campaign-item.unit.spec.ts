/**
 * #2684 — "Retry" on a failed campaign item minted a NEW post, which went to
 * Instagram a second time (public duplicate, robe, 2026-11-27). A retry must
 * reuse the item's existing post so smart retry resends only what failed.
 */
const unifiedRun = jest.fn()
const processRun = jest.fn()

jest.mock("../../publish-social-post-unified", () => ({
  publishSocialPostUnifiedWorkflow: () => ({ run: unifiedRun }),
}))
jest.mock("../process-campaign-item-workflow", () => ({
  processCampaignItemWorkflow: () => ({ run: processRun }),
}))

import { retryCampaignItem } from "../retry-campaign-item"

const campaign = { id: "camp_1", name: "New Products", platform_id: "plat_1", content_rule: {} as any }

const scopeWith = (posts: any[]) =>
  ({
    resolve: () => ({
      listSocialPosts: async ({ id }: { id: string }) => posts.filter((p) => p.id === id),
    }),
  }) as any

beforeEach(() => {
  unifiedRun.mockReset()
  processRun.mockReset()
  unifiedRun.mockResolvedValue({ result: { success: true, post: { post_url: "https://facebook.com/p/1" } } })
  processRun.mockResolvedValue({ result: { success: true, social_post_id: "spost_NEW", post_url: null, error: null } })
})

describe("retryCampaignItem", () => {
  it("retries the item's existing post — never builds a new one", async () => {
    const scope = scopeWith([{ id: "spost_OLD", status: "failed" }])
    const r = await retryCampaignItem(scope, {
      campaign,
      item: { product_id: "prod_1", status: "failed", social_post_id: "spost_OLD" } as any,
      item_index: 1,
      platform_name: "FBINSTA",
    })

    expect(unifiedRun).toHaveBeenCalledWith({ input: { post_id: "spost_OLD" } })
    expect(processRun).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: true, social_post_id: "spost_OLD", reused_post: true })
  })

  it("an already-posted post sends nothing; the item is just published", async () => {
    const scope = scopeWith([{ id: "spost_OLD", status: "posted", post_url: "https://facebook.com/p/9" }])
    const r = await retryCampaignItem(scope, {
      campaign,
      item: { product_id: "prod_1", status: "failed", social_post_id: "spost_OLD" } as any,
      item_index: 1,
      platform_name: "FBINSTA",
    })

    expect(unifiedRun).not.toHaveBeenCalled()
    expect(processRun).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: true, social_post_id: "spost_OLD", post_url: "https://facebook.com/p/9" })
  })

  it("a failed retry of the existing post stays on that post", async () => {
    unifiedRun.mockResolvedValue({ result: { success: false } })
    const scope = scopeWith([{ id: "spost_OLD", status: "failed" }])
    const r = await retryCampaignItem(scope, {
      campaign,
      item: { product_id: "prod_1", status: "failed", social_post_id: "spost_OLD" } as any,
      item_index: 1,
      platform_name: "FBINSTA",
    })
    expect(processRun).not.toHaveBeenCalled()
    expect(r).toMatchObject({ success: false, social_post_id: "spost_OLD", error: "Publishing failed" })
  })

  it("an item with no post (first attempt died early) builds one", async () => {
    const r = await retryCampaignItem(scopeWith([]), {
      campaign,
      item: { product_id: "prod_1", status: "failed" } as any,
      item_index: 0,
      platform_name: "FBINSTA",
    })
    expect(processRun).toHaveBeenCalledTimes(1)
    expect(unifiedRun).not.toHaveBeenCalled()
    expect(r).toMatchObject({ social_post_id: "spost_NEW", reused_post: false })
  })

  it("an item whose post was deleted builds a new one", async () => {
    const r = await retryCampaignItem(scopeWith([]), {
      campaign,
      item: { product_id: "prod_1", status: "failed", social_post_id: "spost_GONE" } as any,
      item_index: 0,
      platform_name: "FBINSTA",
    })
    expect(processRun).toHaveBeenCalledTimes(1)
    expect(r.social_post_id).toBe("spost_NEW")
  })
})
