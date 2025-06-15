
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
        platformId = platformResponse.data.socialplatform.id;
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
          expect(createResponse.data.socialpost).toBeDefined();
          const createdId = createResponse.data.socialpost.id;
          expect(createdId).not.toBeNull();
  
          // 2. Get
          const getResponse = await api.get(`/admin/social-post/${createdId}`, adminHeaders);
          expect(getResponse.status).toBe(200);
          expect(getResponse.data.socialpost.id).toEqual(createdId);
  
          // 3. Update
          const updatePayload = {
            status: "archived"
          };
          const updateResponse = await api.post(
            `/admin/social-post/${createdId}`,
            updatePayload,
            adminHeaders
          );
          expect(updateResponse.status).toBe(200);
          expect(updateResponse.data.socialpost.status).toEqual("archived");
  
          // 4. List
          const listResponse = await api.get(`/admin/social-post`, adminHeaders);
          expect(listResponse.status).toBe(200);
          expect(listResponse.data.socialposts).toBeInstanceOf(Array);
          
          // 5. Delete
          const deleteResponse = await api.delete(`/admin/social-post/${createdId}`, adminHeaders);
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "socialpost",
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
  