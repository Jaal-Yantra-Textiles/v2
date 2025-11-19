import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(60000)

setupSharedTestSuite(() => {
  let headers
  let platformId: string
  let postId: string
  const { api, getContainer } = getSharedTestEnv()

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  describe("Unified Workflow - Validation Tests", () => {
    describe("Post Creation and Validation", () => {
      it("should create a social platform", async () => {
        const response = await api.post(
          "/admin/social-platforms",
          {
            name: "Facebook Test",
            category: "social",
            auth_type: "oauth2",
            status: "active",
            api_config: {
              access_token: "test_token_will_fail_on_publish",
            },
          },
          headers
        )

        expect(response.status).toBe(201)
        expect(response.data.socialPlatform).toBeDefined()
        expect(response.data.socialPlatform.id).toBeDefined()
        platformId = response.data.socialPlatform.id
      })

      it("should create a social post with proper format", async () => {
        // First create platform
        const platformResponse = await api.post(
          "/admin/social-platforms",
          {
            name: "Facebook",
            category: "social",
            auth_type: "oauth2",
            status: "active",
            api_config: {
              access_token: "test_token",
            },
          },
          headers
        )
        platformId = platformResponse.data.socialPlatform.id

        // Create post with correct media_attachments format (object, not array)
        const postResponse = await api.post(
          "/admin/social-posts",
          {
            name: "Test Post",
            caption: "Test caption #hashtag @mention",
            status: "draft",
            platform_id: platformId,
            media_attachments: {
              "0": {
                type: "image",
                url: "https://example.com/image.jpg",
              },
            },
            metadata: {
              page_id: "123456789",
              publish_target: "facebook",
            },
          },
          headers
        )

        expect(postResponse.status).toBe(201)
        expect(postResponse.data.socialPost).toBeDefined()
        expect(postResponse.data.socialPost.id).toBeDefined()
        expect(postResponse.data.socialPost.caption).toBe("Test caption #hashtag @mention")
        postId = postResponse.data.socialPost.id
      })

      it("should reject post with array media_attachments", async () => {
        const platformResponse = await api.post(
          "/admin/social-platforms",
          {
            name: "Facebook",
            category: "social",
            auth_type: "oauth2",
            status: "active",
          },
          headers
        )
        platformId = platformResponse.data.socialPlatform.id

        try {
          await api.post(
            "/admin/social-posts",
            {
              name: "Test Post",
              caption: "Test",
              status: "draft",
              platform_id: platformId,
              media_attachments: [  // ❌ Wrong format (array)
                {
                  type: "image",
                  url: "https://example.com/image.jpg",
                },
              ],
            },
            headers
          )
          fail("Should have thrown validation error")
        } catch (error: any) {
          expect(error.response.status).toBe(400)
          expect(error.response.data.message).toContain("media_attachments")
        }
      })
    })

    describe("Publish Endpoint - Error Handling", () => {
      beforeEach(async () => {
        // Create platform and post for each test
        const platformResponse = await api.post(
          "/admin/social-platforms",
          {
            name: "Facebook",
            category: "social",
            auth_type: "oauth2",
            status: "active",
            api_config: {
              access_token: "test_invalid_token",
            },
          },
          headers
        )
        platformId = platformResponse.data.socialPlatform.id

        const postResponse = await api.post(
          "/admin/social-posts",
          {
            name: "Test Post",
            caption: "Test caption",
            status: "draft",
            platform_id: platformId,
            media_attachments: {
              "0": {
                type: "image",
                url: "https://example.com/image.jpg",
              },
            },
            metadata: {
              page_id: "123456789",
              publish_target: "facebook",
            },
          },
          headers
        )
        postId = postResponse.data.socialPost.id
      })

      it("should fail gracefully with invalid token (expected behavior)", async () => {
        // This tests that the workflow handles API errors properly
        try {
          await api.post(
            `/admin/social-posts/${postId}/publish`,
            {},
            headers
          )
          fail("Should have failed with invalid token")
        } catch (error: any) {
          expect(error.response.status).toBe(400)
          expect(error.response.data.message).toContain("Publishing failed")
          // The error should mention the Facebook API error
          expect(error.response.data.message).toMatch(/Facebook|OAuth|token/i)
        }
      })

      it("should validate missing page_id before calling API", async () => {
        // Update post to remove page_id
        await api.post(
          `/admin/social-posts/${postId}`,
          {
            metadata: {
              publish_target: "facebook",
              // page_id removed
            },
          },
          headers
        )

        try {
          await api.post(
            `/admin/social-posts/${postId}/publish`,
            {},
            headers
          )
          fail("Should have failed validation")
        } catch (error: any) {
          expect(error.response.status).toBe(400)
          expect(error.response.data.message).toContain("page_id")
        }
      })

      it("should accept page_id override", async () => {
        // Remove page_id from metadata
        await api.post(
          `/admin/social-posts/${postId}`,
          {
            metadata: {
              publish_target: "facebook",
            },
          },
          headers
        )

        // Should still fail (invalid token) but NOT because of missing page_id
        try {
          await api.post(
            `/admin/social-posts/${postId}/publish`,
            {
              override_page_id: "987654321",
            },
            headers
          )
          fail("Should have failed with invalid token")
        } catch (error: any) {
          expect(error.response.status).toBe(400)
          // Should NOT complain about missing page_id
          expect(error.response.data.message).not.toContain("No Facebook page_id found")
          // Should fail at the API call stage
          expect(error.response.data.message).toContain("Publishing failed")
        }
      })
    })

    describe("Token Encryption", () => {
      it("should encrypt tokens when creating platform", async () => {
        const response = await api.post(
          "/admin/social-platforms",
          {
            name: "Test Platform",
            category: "social",
            auth_type: "oauth2",
            status: "active",
            api_config: {
              access_token: "plaintext_token_12345",
            },
          },
          headers
        )

        const platformId = response.data.socialPlatform.id

        // Fetch platform to check encryption
        const fetchedPlatform = await api.get(
          `/admin/social-platforms/${platformId}`,
          headers
        )

        const apiConfig = fetchedPlatform.data.socialPlatform.api_config
        
        // Token should be encrypted
        expect(apiConfig.access_token_encrypted).toBeDefined()
        expect(apiConfig.access_token_encrypted.encrypted).toBeDefined()
        expect(apiConfig.access_token_encrypted.iv).toBeDefined()
        expect(apiConfig.access_token_encrypted.authTag).toBeDefined()
      })
    })
  })
})
