
  import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
  import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";
  
  jest.setTimeout(60000);
  
  medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      let adminHeaders;
      let platformId;
  
      beforeEach(async () => {
        const container = getContainer();
        await createAdminUser(container);
        adminHeaders = await getAuthHeaders(api);
  
        // Create SocialPlatform
        const platformResponse = await api.post(
          '/admin/social-platform',
          { name: 'Test SocialPlatform' },
          adminHeaders
        );
        expect(platformResponse.status).toBe(201);
        platformId = platformResponse.data.socialPlatform.id;
      });
  
      describe("Social Post API", () => {
        it("should perform full CRUD for a social post", async () => {
          // 1. Create
          const createPayload = {
            platform_id: platformId,
            status: "draft"
          };
          const createResponse = await api.post(
            "/admin/social-post",
            createPayload,
            adminHeaders
          );
          expect(createResponse.status).toBe(201);
          expect(createResponse.data.socialPost).toBeDefined();
          const createdId = createResponse.data.socialPost.id;
          expect(createdId).not.toBeNull();
  
          // 2. Get
          const getResponse = await api.get(`/admin/social-post/${createdId}`, adminHeaders);
          expect(getResponse.status).toBe(200);
          expect(getResponse.data.socialPost.id).toEqual(createdId);
  
          // 3. Update
          const updatePayload = {
            status: "scheduled"
          };
          const updateResponse = await api.post(
            `/admin/social-post/${createdId}`,
            updatePayload,
            adminHeaders
          );
          expect(updateResponse.status).toBe(200);
          expect(updateResponse.data.socialPost.status).toEqual("scheduled");
  
          // 4. List
          const listResponse = await api.get(`/admin/social-post`, adminHeaders);
          expect(listResponse.status).toBe(200);
          expect(listResponse.data.socialPosts).toBeInstanceOf(Array);
          
          // 5. Delete
          const deleteResponse = await api.delete(`/admin/social-post/${createdId}`, adminHeaders);
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "social_post", // Medusa default is often snake_case for 'object' key, verify if this needs to be modelNameCamel
            deleted: true,
          });
  
          // 6. Verify Deletion
          await api.get(`/admin/social-post/${createdId}`, adminHeaders).catch(err => {
            expect(err.response.status).toBe(404);
          });
        });
      });
    },
  });
  