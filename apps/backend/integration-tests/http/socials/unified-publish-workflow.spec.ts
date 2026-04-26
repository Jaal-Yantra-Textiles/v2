import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  let headers
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  describe("Unified Publishing Workflow - Expected Failures", () => {
    it("should execute workflow and fail at Facebook API (expected)", async () => {
      const platformResponse = await api.post(
        "/admin/social-platforms",
        {
          name: "Facebook",
          category: "social",
          auth_type: "oauth2",
          status: "active",
          api_config: { access_token: "fake_token" },
        },
        headers
      )
      const platformId = platformResponse.data.socialPlatform.id

      const postResponse = await api.post(
        "/admin/social-posts",
        {
          name: "Test Post",
          caption: "Test",
          status: "draft",
          platform_id: platformId,
          media_attachments: {
            "0": { type: "image", url: "https://example.com/image.jpg" },
          },
          metadata: { page_id: "123456789", publish_target: "facebook" },
        },
        headers
      )
      const postId = postResponse.data.socialPost.id

      try {
        await api.post(`/admin/social-posts/${postId}/publish`, {}, headers)
        fail("Should have failed with invalid token")
      } catch (error: any) {
        expect(error.response.status).toBe(400)
        expect(error.response.data.message).toContain("Publishing failed")
        expect(error.response.data.message).toMatch(/OAuth|Invalid.*token/i)
      }
    })

    it("should validate missing page_id", async () => {
      const platformResponse = await api.post(
        "/admin/social-platforms",
        { name: "Facebook", category: "social", auth_type: "oauth2", status: "active", api_config: { access_token: "fake" } },
        headers
      )
      const platformId = platformResponse.data.socialPlatform.id

      const postResponse = await api.post(
        "/admin/social-posts",
        {
          name: "Test",
          caption: "Test",
          status: "draft",
          platform_id: platformId,
          media_attachments: { "0": { type: "image", url: "https://example.com/image.jpg" } },
          metadata: { publish_target: "facebook" },
        },
        headers
      )
      const postId = postResponse.data.socialPost.id

      try {
        await api.post(`/admin/social-posts/${postId}/publish`, {}, headers)
        fail("Should have failed")
      } catch (error: any) {
        expect(error.response.status).toBe(400)
        expect(error.response.data.message).toContain("page_id")
      }
    })

    it("should reject array format for media_attachments", async () => {
      const platformResponse = await api.post(
        "/admin/social-platforms",
        { name: "Facebook", category: "social", auth_type: "oauth2", status: "active" },
        headers
      )
      const platformId = platformResponse.data.socialPlatform.id

      try {
        await api.post(
          "/admin/social-posts",
          {
            name: "Test",
            caption: "Test",
            status: "draft",
            platform_id: platformId,
            media_attachments: [{ type: "image", url: "https://example.com/image.jpg" }],
          },
          headers
        )
        fail("Should have failed validation")
      } catch (error: any) {
        expect(error.response.status).toBe(400)
        expect(error.response.data.message).toContain("media_attachments")
      }
    })
  })
})
