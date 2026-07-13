import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"

jest.setTimeout(30000);

describe("Social Post API", () => {
  medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      let adminHeaders;

      beforeEach(async () => {
        const container = getContainer();
        await createAdminUser(container);
        adminHeaders = await getAuthHeaders(api);
      });

      describe("Social Post API", () => {
        it("should reject unrecognized top-level metadata fields", async () => {
          const platformResponse = await api.post(
            '/admin/social-platforms',
            { name: 'Test SocialPlatform' },
            adminHeaders
          );
          const platformId = platformResponse.data.socialPlatform.id;

          const payload = {
            name: "Test Post",
            platform_id: platformId,
            page_id: "fb_page_123",
            ig_user_id: "ig_acct_456",
            publish_target: "both",
            auto_publish: true,
            is_campaign: false,
            product_ids: ["prod_1", "prod_2"],
            interval_hours: 24,
          };

          try {
            await api.post("/admin/social-posts", payload, adminHeaders);
            fail("Should have rejected unrecognized top-level fields");
          } catch (err: any) {
            expect(err.response.status).toBe(400);
            expect(err.response.data.message).toContain("Unrecognized fields");
            expect(err.response.data.message).toContain("page_id");
            expect(err.response.data.message).toContain("ig_user_id");
            expect(err.response.data.message).toContain("publish_target");
            expect(err.response.data.message).toContain("auto_publish");
            expect(err.response.data.message).toContain("is_campaign");
            expect(err.response.data.message).toContain("product_ids");
            expect(err.response.data.message).toContain("interval_hours");
          }
        });

        it("should accept metadata fields nested inside metadata object", async () => {
          const platformResponse = await api.post(
            '/admin/social-platforms',
            { name: 'Test SocialPlatform' },
            adminHeaders
          );
          const platformId = platformResponse.data.socialPlatform.id;

          const payload = {
            name: "Test Post with Metadata",
            platform_id: platformId,
            message: "Check out our new collection!",
            media_urls: ["https://example.com/image.jpg"],
            metadata: {
              page_id: "fb_page_123",
              ig_user_id: "ig_acct_456",
              publish_target: "both",
              auto_publish: true,
            },
          };

          const response = await api.post("/admin/social-posts", payload, adminHeaders);
          expect(response.status).toBe(201);
          expect(response.data.socialPost).toBeDefined();
          expect(response.data.socialPost.metadata).toBeDefined();
          expect(response.data.socialPost.metadata.page_id).toBe("fb_page_123");
          expect(response.data.socialPost.metadata.ig_user_id).toBe("ig_acct_456");
          expect(response.data.socialPost.metadata.publish_target).toBe("both");
          expect(response.data.socialPost.metadata.auto_publish).toBe(true);
        });

        it("should perform full CRUD for a social post", async () => {
          console.log("Starting social post CRUD test");

          // Create SocialPlatform
          const platformResponse = await api.post(
            '/admin/social-platforms',
            { name: 'Test SocialPlatform' },
            adminHeaders
          );
          expect(platformResponse.status).toBe(201);
          const platformId = platformResponse.data.socialPlatform.id;
          console.log(`Created social platform with ID: ${platformId}`);

          // 1. Create
          const createPayload = {
            name: "Test name",
            platform_id: platformId,
            status: "draft"
          };
          const createResponse = await api.post(
            "/admin/social-posts",
            createPayload,
            adminHeaders
          );
          expect(createResponse.status).toBe(201);
          expect(createResponse.data.socialPost).toBeDefined();
          const createdId = createResponse.data.socialPost.id;
          expect(createdId).not.toBeNull();
          console.log(`Created social post with ID: ${createdId}`);
          
          // 2. Get
          const getResponse = await api.get(`/admin/social-posts/${createdId}`, adminHeaders);
          expect(getResponse.status).toBe(200);
          expect(getResponse.data.socialPost.id).toEqual(createdId);
          console.log("Successfully retrieved social post");
  
          // 3. Update
          const updatePayload = {
            status: "scheduled"
          };
          const updateResponse = await api.post(
            `/admin/social-posts/${createdId}`,
            updatePayload,
            adminHeaders
          );
          expect(updateResponse.status).toBe(200);
          expect(updateResponse.data.socialPost.status).toEqual("scheduled");
          console.log("Successfully updated social post");
  
          // 4. List
          const listResponse = await api.get(`/admin/social-posts`, adminHeaders);
          expect(listResponse.status).toBe(200);
          expect(listResponse.data.socialPosts).toBeInstanceOf(Array);
          console.log("Successfully listed social posts");
          
          // 5. Delete
          const deleteResponse = await api.delete(`/admin/social-posts/${createdId}`, adminHeaders);
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "social_post",
            deleted: true,
          });
          console.log("Successfully deleted social post");
  
          // 6. Verify Deletion
          await api.get(`/admin/social-posts/${createdId}`, adminHeaders).catch(err => {
            expect(err.response.status).toBe(404);
          });
          console.log("Successfully verified deletion");
        });
      });
    },
  });
});