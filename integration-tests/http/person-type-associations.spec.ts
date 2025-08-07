import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(30000);

setupSharedTestSuite(() => {
    let headers;
    let personId;
    let personTypeIds: string[] = [];
    const { api , getContainer } = getSharedTestEnv();
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
    });

    describe("Person Type Associations", () => {
      beforeEach(async () => {
        // Create a test person
        const newPerson = {
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
          date_of_birth: "1990-01-01",
        };

        const personResponse = await api.post("/admin/persons", newPerson, headers);
        personId = personResponse.data.person.id;

        // Create two person types
        const personType1 = {
          name: "Employee",
          description: "Company employee",
        };

        const personType2 = {
          name: "Contractor",
          description: "External contractor",
        };

        const type1Response = await api.post("/admin/persontypes", personType1, headers);
        const type2Response = await api.post("/admin/persontypes", personType2, headers);
        
        personTypeIds = [
          type1Response.data.personType.id,
          type2Response.data.personType.id,
        ];
      });

      describe("POST /admin/persons/:id/types", () => {
        it("should associate person types with a person and verify through GET", async () => {
          // Associate person types
          const associateResponse = await api.post(
            `/admin/persons/${personId}/types`,
            { personTypeIds },
            headers
          );
          
          expect(associateResponse.status).toBe(200);
          expect(associateResponse.data.message).toContain(`Person ${personId} successfully associated with ${personTypeIds.length} types`);
          
          // Verify association through GET request
          const getResponse = await api.get(
            `/admin/persons/${personId}`,
            headers
          );

          expect(getResponse.status).toBe(200);
        
          expect(getResponse.data.person.person_types).toBeDefined();
          expect(getResponse.data.person.person_types).toHaveLength(2);
          
          // Verify the associated types match
          const receivedTypeIds = getResponse.data.person.person_types.map(type => type.id);
          expect(receivedTypeIds).toEqual(expect.arrayContaining(personTypeIds));
         
          // Verify type details are included
          getResponse.data.person.person_types.forEach(type => {
            expect(type).toHaveProperty("name");
            expect(type).toHaveProperty("description");
            expect(type).toHaveProperty("created_at");
            expect(type).toHaveProperty("updated_at");
          });
        });

        it("should handle duplicate type ids by associating only unique ones", async () => {
          const duplicateTypeIds = {
            personTypeIds: [personTypeIds[0], personTypeIds[0]]
          };
          
          const associateResponse = await api.post(
            `/admin/persons/${personId}/types`,
            duplicateTypeIds,
            headers
          );

          expect(associateResponse.status).toBe(200);
          expect(associateResponse.data.originalCount).toBe(2);
          expect(associateResponse.data.processedCount).toBe(1);
          
          // Verify the response structure matches the actual API
          expect(associateResponse.data).toHaveProperty('personTypesLink');
          expect(associateResponse.data.personTypesLink).toHaveProperty('list');
          expect(associateResponse.data.personTypesLink).toHaveProperty('count', 1);
          
          // Verify the message indicates duplicate IDs were removed
          expect(associateResponse.data.message).toContain('duplicate IDs were removed');
          
          // Verify only one association was created
          const getResponse = await api.get(
            `/admin/persons/${personId}`,
            headers
          );
          
          expect(getResponse.data.person.person_types).toBeDefined();
          
          // Handle both single object and array cases
          const personTypes = Array.isArray(getResponse.data.person.person_types) 
            ? getResponse.data.person.person_types 
            : [getResponse.data.person.person_types];
            
          expect(personTypes).toHaveLength(1);
          expect(personTypes[0].id).toBe(personTypeIds[0]);
        });
      });

      // Clean up after each test
      afterEach(async () => {
        // Delete the person types
        for (const typeId of personTypeIds) {
          await api.delete(`/admin/persontypes/${typeId}`, headers).catch(() => {});
        }
        
        // Delete the person
        await api.delete(`/admin/persons/${personId}`, headers).catch(() => {});
        
      });
    });
});
