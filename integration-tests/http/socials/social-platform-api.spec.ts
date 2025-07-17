
  import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
  import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";
  
  jest.setTimeout(60000);
  
  medusaIntegrationTestRunner({
    testSuite: ({ api, getContainer }) => {
      let adminHeaders;
      
  
      beforeEach(async () => {
        const container = getContainer();
        await createAdminUser(container);
        adminHeaders = await getAuthHeaders(api);
  
      });
  
      describe("Social Platform API", () => {
        it("should perform full CRUD for a social platform", async () => {
          // 1. Create
          const createPayload = {
            name: "Test name"
          };
          const createResponse = await api.post(
            "/admin/social-platforms",
            createPayload,
            adminHeaders
          );
          expect(createResponse.status).toBe(201);
          expect(createResponse.data.socialPlatform).toBeDefined();
          const createdId = createResponse.data.socialPlatform.id;
          expect(createdId).not.toBeNull();
  
          // 2. Get
          const getResponse = await api.get(`/admin/social-platforms/${createdId}`, adminHeaders);
          expect(getResponse.status).toBe(200);
          
          expect(getResponse.data.socialPlatform.id).toEqual(createdId);
  
          // 3. Update
          const updatePayload = {
            name: "Updated name"
          };
          const updateResponse = await api.post(
            `/admin/social-platforms/${createdId}`,
            updatePayload,
            adminHeaders
          );
          expect(updateResponse.status).toBe(200);
          expect(updateResponse.data.socialPlatform.name).toEqual("Updated name");
  
          // 4. List
          const listResponse = await api.get(`/admin/social-platforms`, adminHeaders);
          expect(listResponse.status).toBe(200);
          
          expect(listResponse.data.socialPlatforms).toBeInstanceOf(Array);
          
          // 5. Delete
          const deleteResponse = await api.delete(`/admin/social-platforms/${createdId}`, adminHeaders);
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "social_platform", // Medusa default is often snake_case for 'object' key, verify if this needs to be modelNameCamel
            deleted: true,
          });
  
          // 6. Verify Deletion
          await api.get(`/admin/social-platforms/${createdId}`, adminHeaders).catch(err => {
            expect(err.response.status).toBe(404);
          });
        });
      });
    },
  });
  