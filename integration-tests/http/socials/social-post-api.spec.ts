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