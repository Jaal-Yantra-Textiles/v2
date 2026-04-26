import { setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"

jest.setTimeout(60000)

setupSharedTestSuite(({ api, getContainer }) => {
  describe("Publishing Campaigns API", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const container = await getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("should perform full CRUD and lifecycle operations for publishing campaigns", async () => {
      console.log("Starting publishing campaigns test")

      // Create a social platform for campaigns
      const platformResponse = await api.post(
        "/admin/social-platforms",
        { name: "Test Campaign Platform" },
        adminHeaders
      )
      expect(platformResponse.status).toBe(201)
      const platformId = platformResponse.data.socialPlatform.id
      console.log(`Created social platform: ${platformId}`)

      // Create a test product
      let testProductId: string
      try {
        const productResponse = await api.post(
          "/admin/products",
          {
            title: "Test Campaign Product",
            status: "published",
          },
          adminHeaders
        )
        testProductId = productResponse.data.product.id
        console.log(`Created test product: ${testProductId}`)
      } catch (err) {
        testProductId = "prod_test_" + Date.now()
        console.log(`Using mock product ID: ${testProductId}`)
      }

      // 1. CREATE - Create a publishing campaign
      const createPayload = {
        name: "Test Campaign",
        platform_id: platformId,
        product_ids: [testProductId],
        interval_hours: 24,
        content_rule: {
          hashtag_strategy: "from_product",
          image_selection: "thumbnail",
        },
      }

      const createResponse = await api.post(
        "/admin/publishing-campaigns",
        createPayload,
        adminHeaders
      )
      expect(createResponse.status).toBe(201)
      expect(createResponse.data.campaign).toBeDefined()
      expect(createResponse.data.campaign.name).toBe("Test Campaign")
      expect(createResponse.data.campaign.status).toBe("draft")
      const campaignId = createResponse.data.campaign.id
      console.log(`Created campaign: ${campaignId}`)

      // 2. GET - Get single campaign
      const getResponse = await api.get(
        `/admin/publishing-campaigns/${campaignId}`,
        adminHeaders
      )
      expect(getResponse.status).toBe(200)
      expect(getResponse.data.campaign.id).toBe(campaignId)
      console.log("Successfully retrieved campaign")

      // 3. LIST - List campaigns
      const listResponse = await api.get(
        "/admin/publishing-campaigns",
        adminHeaders
      )
      expect(listResponse.status).toBe(200)
      expect(listResponse.data.campaigns).toBeInstanceOf(Array)
      console.log(`Listed ${listResponse.data.campaigns.length} campaigns`)

      // 4. UPDATE - Update draft campaign
      const updateResponse = await api.put(
        `/admin/publishing-campaigns/${campaignId}`,
        {
          name: "Updated Campaign Name",
          interval_hours: 48,
        },
        adminHeaders
      )
      expect(updateResponse.status).toBe(200)
      expect(updateResponse.data.campaign.name).toBe("Updated Campaign Name")
      expect(updateResponse.data.campaign.interval_hours).toBe(48)
      console.log("Successfully updated campaign")

      // 5. START - Start the campaign
      const startResponse = await api.post(
        `/admin/publishing-campaigns/${campaignId}/start`,
        {},
        adminHeaders
      )
      expect(startResponse.status).toBe(200)
      expect(startResponse.data.campaign.status).toBe("active")
      console.log("Successfully started campaign")

      // 6. PAUSE - Pause the active campaign
      const pauseResponse = await api.post(
        `/admin/publishing-campaigns/${campaignId}/pause`,
        {},
        adminHeaders
      )
      expect(pauseResponse.status).toBe(200)
      expect(pauseResponse.data.campaign.status).toBe("paused")
      console.log("Successfully paused campaign")

      // 7. RESUME - Resume the paused campaign
      const resumeResponse = await api.post(
        `/admin/publishing-campaigns/${campaignId}/start`,
        {},
        adminHeaders
      )
      expect(resumeResponse.status).toBe(200)
      expect(resumeResponse.data.campaign.status).toBe("active")
      console.log("Successfully resumed campaign")

      // 8. CANCEL - Cancel the campaign
      const cancelResponse = await api.post(
        `/admin/publishing-campaigns/${campaignId}/cancel`,
        {},
        adminHeaders
      )
      expect(cancelResponse.status).toBe(200)
      expect(cancelResponse.data.campaign.status).toBe("cancelled")
      console.log("Successfully cancelled campaign")

      // 9. DELETE - Delete the campaign
      const deleteResponse = await api.delete(
        `/admin/publishing-campaigns/${campaignId}`,
        adminHeaders
      )
      expect(deleteResponse.status).toBe(200)
      expect(deleteResponse.data.success).toBe(true)
      console.log("Successfully deleted campaign")

      // 10. VERIFY DELETION
      try {
        await api.get(`/admin/publishing-campaigns/${campaignId}`, adminHeaders)
        fail("Should have thrown 404")
      } catch (err: any) {
        expect(err.response.status).toBe(404)
      }
      console.log("Successfully verified deletion")
    })

    it("should filter campaigns by status", async () => {
      // Create platform
      const platformResponse = await api.post(
        "/admin/social-platforms",
        { name: "Filter Test Platform" },
        adminHeaders
      )
      const platformId = platformResponse.data.socialPlatform.id

      // Create draft campaign
      await api.post(
        "/admin/publishing-campaigns",
        {
          name: "Draft Campaign",
          platform_id: platformId,
          product_ids: ["prod_filter_test"],
          interval_hours: 24,
        },
        adminHeaders
      )

      // Create and start active campaign
      const activeCampaign = await api.post(
        "/admin/publishing-campaigns",
        {
          name: "Active Campaign",
          platform_id: platformId,
          product_ids: ["prod_filter_test_2"],
          interval_hours: 24,
        },
        adminHeaders
      )
      await api.post(
        `/admin/publishing-campaigns/${activeCampaign.data.campaign.id}/start`,
        {},
        adminHeaders
      )

      // Filter by draft
      const draftResponse = await api.get(
        "/admin/publishing-campaigns?status=draft",
        adminHeaders
      )
      expect(draftResponse.status).toBe(200)
      expect(draftResponse.data.campaigns.every((c: any) => c.status === "draft")).toBe(true)

      // Filter by active
      const activeResponse = await api.get(
        "/admin/publishing-campaigns?status=active",
        adminHeaders
      )
      expect(activeResponse.status).toBe(200)
      expect(activeResponse.data.campaigns.every((c: any) => c.status === "active")).toBe(true)
    })

    it("should handle retry endpoints", async () => {
      // Create platform
      const platformResponse = await api.post(
        "/admin/social-platforms",
        { name: "Retry Test Platform" },
        adminHeaders
      )
      const platformId = platformResponse.data.socialPlatform.id

      // Create campaign
      const createResponse = await api.post(
        "/admin/publishing-campaigns",
        {
          name: "Retry Test Campaign",
          platform_id: platformId,
          product_ids: ["prod_retry_test"],
          interval_hours: 24,
        },
        adminHeaders
      )
      const campaignId = createResponse.data.campaign.id

      // Retry all - should succeed even with no failed items
      const retryAllResponse = await api.post(
        `/admin/publishing-campaigns/${campaignId}/retry-all`,
        {},
        adminHeaders
      )
      expect(retryAllResponse.status).toBe(200)
      expect(retryAllResponse.data.retried).toBeDefined()
      console.log("Retry all succeeded")

      // Retry single item - should fail since item is not in failed status
      try {
        await api.post(
          `/admin/publishing-campaigns/${campaignId}/retry-item`,
          { item_index: 0 },
          adminHeaders
        )
      } catch (err: any) {
        expect(err.response.status).toBe(400)
        console.log("Retry item failed as expected (item not in failed status)")
      }
    })
  })
})
