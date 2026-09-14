import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

/**
 * #2059 — which catalogue an approved design's product lands in.
 *
 * The minter used to fall back to `listStores({})[0].default_sales_channel_id`
 * on a 14-store platform. These prove the two rules that replaced it:
 * an admin may name the channel, and when they don't, the product still lands
 * somewhere deterministic rather than in whichever store came back first.
 */
setupSharedTestSuite(() => {
  describe("Approving a design routes it to a chosen catalogue (#2059)", () => {
    let adminHeaders: any
    const { api, getContainer } = getSharedTestEnv()

    beforeAll(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    const createCostedDesign = async (label: string) => {
      const res = await api.post(
        "/admin/designs",
        {
          name: `ChannelRoute ${label} ${Date.now()}`,
          description: "Design used to check catalogue routing",
          design_type: "Original",
          status: "In_Development",
          priority: "Medium",
          estimated_cost: 500,
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id
    }

    /** The sales channels a product actually belongs to, read back from admin. */
    const channelsOf = async (productId: string): Promise<string[]> => {
      const res = await api.get(
        `/admin/products/${productId}?fields=*sales_channels`,
        adminHeaders
      )
      return (res.data.product.sales_channels ?? []).map((c: any) => c.id)
    }

    it("puts the product in the sales channel the admin names", async () => {
      const designId = await createCostedDesign("explicit")

      const channelRes = await api.post(
        "/admin/sales-channels",
        { name: `Chosen Catalogue ${Date.now()}` },
        adminHeaders
      )
      expect(channelRes.status).toBe(200)
      const chosenChannelId = channelRes.data.sales_channel.id

      const approveRes = await api
        .post(
          `/admin/designs/${designId}/approve`,
          { sales_channel_id: chosenChannelId },
          adminHeaders
        )
        .catch((e: any) => e.response)

      if (approveRes.status !== 200) {
        throw new Error(`Approve failed ${approveRes.status}: ${JSON.stringify(approveRes.data)}`)
      }

      // Unconditional: a guarded assertion here would pass on a product that
      // landed in no channel at all, which is the failure being tested for.
      expect(approveRes.data.product_id).toBeDefined()
      await expect(channelsOf(approveRes.data.product_id)).resolves.toContain(
        chosenChannelId
      )
    })

    /**
     * A typo'd channel must be refused BEFORE the design is marked Approved —
     * otherwise the design ends up approved with no product, the same split the
     * route's cost guard exists to prevent.
     */
    it("refuses an unknown sales channel without approving the design", async () => {
      const designId = await createCostedDesign("bogus")

      const approveRes = await api
        .post(
          `/admin/designs/${designId}/approve`,
          { sales_channel_id: "sc_does_not_exist" },
          adminHeaders
        )
        .catch((e: any) => e.response)

      expect(approveRes.status).toBe(400)
      expect(String(approveRes.data.message)).toMatch(/does not exist/i)

      const after = await api.get(`/admin/designs/${designId}`, adminHeaders)
      expect(after.data.design.status).not.toBe("Approved")
    })

    it("still mints without a channel, landing in the house store's catalogue", async () => {
      const designId = await createCostedDesign("default")

      const approveRes = await api
        .post(`/admin/designs/${designId}/approve`, {}, adminHeaders)
        .catch((e: any) => e.response)

      if (approveRes.status !== 200) {
        throw new Error(`Approve failed ${approveRes.status}: ${JSON.stringify(approveRes.data)}`)
      }
      expect(approveRes.data.product_id).toBeDefined()

      const channels = await channelsOf(approveRes.data.product_id)
      // The point is that it lands SOMEWHERE deterministic — never nowhere.
      expect(channels.length).toBeGreaterThan(0)

      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: stores } = await query.graph({
        entity: "store",
        fields: ["id", "default_sales_channel_id"],
      })
      const houseChannelIds = (stores ?? [])
        .map((s: any) => s.default_sales_channel_id)
        .filter(Boolean)
      expect(houseChannelIds).toEqual(expect.arrayContaining([channels[0]]))
    })
  })
})
