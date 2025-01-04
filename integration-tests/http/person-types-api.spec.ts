import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let personTypeId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
    });

    describe("POST /admin/persontypes", () => {
      it("should create a new person type", async () => {
        const newPersonType = {
          name: "Supplier",
          description: "A person who supplies goods or services",
        };

        const response = await api.post("/admin/persontypes", newPersonType, headers);
        
        expect(response.status).toBe(201);
        expect(response.data.personType).toMatchObject({
          ...newPersonType,
          id: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
          deleted_at: null,
        });

        personTypeId = response.data.personType.id;
      });

      it("should fail to create a person type without required fields", async () => {
        const invalidPersonType = {
          description: "Missing name field",
        };

        const response = await api.post("/admin/persontypes", invalidPersonType, headers).catch(e => e.response);
        expect(response.status).toBe(400);
        expect(response.data.issues).toBeDefined();
      });
    });

    describe("GET /admin/persontype/:id", () => {
      it("should retrieve a person type", async () => {
        const created = await api.post(
          "/admin/persontypes",
          {
            name: "Customer",
            description: "A person who buys goods or services",
          },
          headers
        );

        const response = await api.get(
          `/admin/persontypes/${created.data.personType.id}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.personType).toEqual(
          expect.objectContaining({
            name: "Customer",
            description: "A person who buys goods or services",
          })
        );
      });

      it("should return 404 for non-existent person type", async () => {
        const response = await api.get("/admin/persontypes/non-existent-id", headers).catch(e => e.response);
        expect(response.status).toBe(404);
      });
    });

    describe("GET /admin/persontype", () => {
      it("should list all person types", async () => {
        const response = await api.get("/admin/persontypes", headers);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data.personTypes)).toBe(true);
      });
    });

    describe("PUT /admin/persontypes/:id", () => {
      it("should update a person type", async () => {
        const created = await api.post(
          "/admin/persontypes",
          {
            name: "Employee",
            description: "A person who works for the company",
          },
          headers
        );

        const response = await api.post(
          `/admin/persontypes/${created.data.personType.id}`,
          { name: "Staff Member" },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.personType.name).toBe("Staff Member");
      });

      it("should fail to update non-existent person type", async () => {
        const response = await api.put(
          "/admin/persontypes/non-existent-id",
          { name: "Updated Name" },
          headers
        ).catch(e => e.response);
        expect(response.status).toBe(404);
      });
    });

    describe("DELETE /admin/persontypes/:id", () => {
      it("should delete a person type", async () => {
        const created = await api.post(
          "/admin/persontypes",
          {
            name: "Temporary",
            description: "To be deleted",
          },
          headers
        );

        const response = await api.delete(
          `/admin/persontypes/${created.data.personType.id}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data).toEqual(
          expect.objectContaining({
            id: created.data.personType.id,
            deleted: true,
          })
        );

        // Verify the person type is actually deleted
        const getResponse = await api.get(`/admin/persontypes/${created.data.personType.id}`, headers).catch(e => e.response);
        expect(getResponse.status).toBe(404);
      });

      it("should fail to delete non-existent person type", async () => {
        const response = await api.delete("/admin/persontypes/non-existent-id", headers).catch(e => e.response);
        expect(response.status).toBe(404);
      });
    });
  },
});