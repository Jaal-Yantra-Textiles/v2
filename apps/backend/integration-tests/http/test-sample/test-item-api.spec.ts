
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
  
      describe("Test Item API", () => {
        it("should perform full CRUD for a test item", async () => {
          // 1. Create
          const createPayload = {
            name: "Test name",
            status: "active"
          };
          const createResponse = await api.post(
            "/admin/test-item",
            createPayload,
            adminHeaders
          );
          expect(createResponse.status).toBe(201);
          expect(createResponse.data.testItem).toBeDefined();
          const createdId = createResponse.data.testItem.id;
          expect(createdId).not.toBeNull();
  
          // 2. Get
          const getResponse = await api.get(`/admin/test-item/${createdId}`, adminHeaders);
          expect(getResponse.status).toBe(200);
          expect(getResponse.data.testItem.id).toEqual(createdId);
  
          // 3. Update
          const updatePayload = {
            name: "Updated name"
          };
          const updateResponse = await api.post(
            `/admin/test-item/${createdId}`,
            updatePayload,
            adminHeaders
          );
          expect(updateResponse.status).toBe(200);
          expect(updateResponse.data.testItem.name).toEqual("Updated name");
  
          // 4. List
          const listResponse = await api.get(`/admin/test-item`, adminHeaders);
          expect(listResponse.status).toBe(200);
          expect(listResponse.data.testItems).toBeInstanceOf(Array);
          
          // 5. Delete
          const deleteResponse = await api.delete(`/admin/test-item/${createdId}`, adminHeaders);
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "test_item", // Medusa default is often snake_case for 'object' key, verify if this needs to be modelNameCamel
            deleted: true,
          });
  
          // 6. Verify Deletion
          await api.get(`/admin/test-item/${createdId}`, adminHeaders).catch(err => {
            expect(err.response.status).toBe(404);
          });
        });
      });
    },
  });
  