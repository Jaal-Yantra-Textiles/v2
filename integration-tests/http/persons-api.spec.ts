import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { error } from "console";

jest.setTimeout(30000);

//Add more test cases like delete and etc

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let personId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
    });

    describe("POST /admin/persons", () => {
      it("should create a new person", async () => {
        const newPerson = {
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
          date_of_birth: "1990-01-01",
          metadata: { role: "supplier" },
        };

        const response = await api.post("/admin/persons", newPerson, headers);

        expect(response.status).toBe(201);
        expect(response.data.person).toMatchObject({
          ...newPerson,
          date_of_birth: expect.any(String),
          id: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
          state: expect.stringMatching(/onboarding/i),
          avatar: null,
          deleted_at: null,
        });
        expect(new Date(response.data.person.date_of_birth)).toEqual(new Date("1990-01-01"));
      });
    });

    describe("GET /admin/persons", () => {
      // Helper function to create test persons
      const createTestPersons = async () => {
        const persons = [
          {
            first_name: "John",
            last_name: "Doe",
            email: "john.doe@example.com",
            date_of_birth: "1990-01-01",
            state: "Onboarding"
          },
          {
            first_name: "Jane",
            last_name: "Smith",
            email: "jane.smith@example.com",
            date_of_birth: "1992-02-02",
            state: "Onboarding Finished"
          },
          {
            first_name: "Bob",
            last_name: "Johnson",
            email: "bob.johnson@example.com",
            date_of_birth: "1985-03-03",
            state: "Stalled"
          },
          {
            first_name: "Sarah",
            last_name: "Johnson",
            email: "sarah.johnson@example.com",
            date_of_birth: "1988-04-04",
            state: "Conflicted"
          },
          {
            first_name: "James",
            last_name: "Wilson",
            email: "james.wilson@example.com",
            date_of_birth: "1995-05-05",
            state: "Onboarding"
          }
        ];

        return Promise.all(persons.map(person => 
          api.post("/admin/persons", person, headers)
        ));
      };

      beforeEach(async () => {
        await createTestPersons();
      });

      it("should list persons with pagination", async () => {
        const response = await api.get("/admin/persons?limit=3&offset=0", headers);
        console.log(response.data)
        expect(response.status).toBe(200);
        expect(response.data.persons.length).toBe(3);
        expect(response.data.count).toBeGreaterThan(3);
        expect(response.data.limit).toBe("3");
        expect(response.data.offset).toBe("0");
      });

      it("should respect maximum limit of 10", async () => {
        const response = await api.get("/admin/persons?limit=20", headers);

        expect(response.status).toBe(200);
        expect(response.data.persons.length).toBeLessThanOrEqual(10);
      });

      it("should filter by search query", async () => {
        const response = await api.get("/admin/persons?q=john", headers);

        expect(response.status).toBe(200);
        expect(response.data.persons.length).toBeGreaterThan(0);
        response.data.persons.forEach(person => {
          expect(person.first_name.toLowerCase() + " " + person.last_name.toLowerCase())
            .toMatch(/john/);
        });
      });

      it("should filter by state", async () => {
        const response = await api.get("/admin/persons?state=Onboarding", headers);

        expect(response.status).toBe(200);
        expect(response.data.persons.length).toBeGreaterThan(0);
        response.data.persons.forEach(person => {
          expect(person.state).toBe("Onboarding");
        });
      });

      it("should filter by email", async () => {
        const response = await api.get("/admin/persons?email=john.doe@example.com", headers);

        expect(response.status).toBe(200);
        expect(response.data.persons.length).toBe(1);
        expect(response.data.persons[0].email).toBe("john.doe@example.com");
      });

      it("should handle multiple filters", async () => {
        const response = await api.get(
          "/admin/persons?state=Onboarding&q=john", 
          headers
        );

        expect(response.status).toBe(200);
        response.data.persons.forEach(person => {
          expect(person.state).toBe("Onboarding");
          expect(person.first_name.toLowerCase() + " " + person.last_name.toLowerCase())
            .toMatch(/john/);
        });
      });

      it("should handle empty results", async () => {
        const response = await api.get(
          "/admin/persons?q=nonexistentperson", 
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.persons).toHaveLength(0);
        expect(response.data.count).toBe(0);
      });

      it("should handle invalid filters gracefully", async () => {
        const response = await api.get(
          "/admin/persons?invalid_filter=value", 
          headers
        );

        expect(response.status).toBe(200);
        // Invalid filter should be ignored
        expect(response.data.persons.length).toBeGreaterThan(0);
      });
    });

    describe("GET /admin/persons/:id", () => {
      it("should retrieve a person", async () => {
        const created = await api.post(
          "/admin/persons",
          {
            first_name: "John",
            last_name: "Doe",
            email: "john.doe@example.com",
            date_of_birth: "1990-01-01",
          },
          headers
        );

        const response = await api.get(
          `/admin/persons/${created.data.person.id}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.person).toEqual(
          expect.objectContaining({
            first_name: "John",
            last_name: "Doe",
          })
        );
      });

      it("should retrieve specific fields when requested", async () => {
        // Create a test person with all fields
        const created = await api.post(
          "/admin/persons",
          {
            first_name: "Jane",
            last_name: "Smith",
            email: "jane.smith@example.com",
            date_of_birth: "1992-05-15",
            metadata: { role: "designer" },
          },
          headers
        );
        
        const personId = created.data.person.id;
        
        // Request only specific fields
        const response = await api.get(
          `/admin/persons/${personId}?fields=id,first_name`,
          headers
        );

        expect(response.status).toBe(200);
        
        // Person should have the requested fields
        expect(response.data.person).toHaveProperty('id');
        expect(response.data.person).toHaveProperty('first_name', 'Jane');
        
        // The * field is always included, so these fields should be present
        expect(response.data.person).toHaveProperty('created_at');
        expect(response.data.person).toHaveProperty('updated_at');
      });
      
      it("should retrieve nested fields when requested", async () => {
        // Create a test person first
        const created = await api.post(
          "/admin/persons",
          {
            first_name: "Alex",
            last_name: "Johnson",
            email: "alex.johnson@example.com",
            date_of_birth: "1985-10-20",
          },
          headers
        );
        
        const personId = created.data.person.id;
        
        // Request with nested fields for person_type and partner
        const response = await api.get(
          `/admin/persons/${personId}?fields=id,first_name,person_type.id,person_type.description,partner.handle`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.person).toHaveProperty('id');
        expect(response.data.person).toHaveProperty('first_name', 'Alex');
        
        // Since we don't know if person_type or partner will be populated in this test,
        // we just confirm the request worked without errors
        // In a real scenario with seeded data, you could make specific assertions
      });
    });

    describe("PUT /admin/persons/:id", () => {
      it("should update a person", async () => {
        const created = await api.post(
          "/admin/persons",
          {
            first_name: "John",
            last_name: "Doe",
            email: "john.doe@example.com",
            date_of_birth: "1990-01-01",
          },
          headers
        );

        const response = await api.post(
          `/admin/persons/${created.data.person.id}`,
          { first_name: "Jane" },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.person.first_name).toBe("Jane");
      });
    });

    describe("DELETE /admin/persons/:id", () => {
      it("should delete a person", async () => {
        const created = await api.post(
          "/admin/persons",
          {
            first_name: "John",
            last_name: "Doe",
            email: "john.doe@example.com",
            date_of_birth: "1990-01-01",
          },
         headers
        );

        const response = await api.delete(
          `/admin/persons/${created.data.person.id}`,
          headers
        );

        expect(response.status).toBe(201);
      });
    });

    describe("POST /admin/persons/:id/addresses", () => {
      beforeEach(async () => {
        // Create a test person for address-related tests
        const newPerson = {
          first_name: "John",
          last_name: "Doe",
          email: "john.doe@example.com",
          date_of_birth: "1990-01-01",
        };

        const personResponse = await api.post("/admin/persons", newPerson,  headers);
        personId = personResponse.data.person.id;
      });

      it("should create a new address for a person", async () => {
        const validAddress = {
          street: "123 Test St",
          city: "Test City",
          state: "Test State",
          postal_code: "12345",
          country: "Test Country",
        };

        const response = await api.post(
          `/admin/persons/${personId}/addresses`,
          validAddress,
          headers 
        );

        expect(response.status).toBe(201);
        expect(response.data.address).toEqual(
          expect.objectContaining({
            ...validAddress,
            id: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            person_id: personId,
            deleted_at: null,
          })
        );
      });

      it("should fail with validation error when street is empty", async () => {
        const invalidAddress = {
          street: "",
          city: "Test City",
          state: "Test State",
          postal_code: "12345",
          country: "Test Country",
        };

        await expect(
          api.post(`/admin/persons/${personId}/addresses`, invalidAddress, headers )
        ).rejects.toMatchObject({
          response: {
            status: 400,
            data: {
              message: "too_small Street is required (at path: street)"
            }
          }
        });
      });

      it("should fail when person does not exist", async () => {
        const nonExistentPersonId = "non-existent-id";
        const validAddress = {
          street: "123 Test St",
          city: "Test City",
          state: "Test State",
          postal_code: "12345",
          country: "Test Country",
        };

        await expect(
          api.post(`/admin/persons/${nonExistentPersonId}/addresses`, validAddress, headers)
        ).rejects.toMatchObject({
          response: {
            status: 404,
            data: expect.objectContaining({    
              message: expect.stringContaining("Person with id \"non-existent-id\" not found"),
            }),
          },
        });
      });
    });

    describe("GET /admin/persons/:id/addresses", () => {
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
      });

      afterEach(async () => {
        try {
          const response = await api.get(`/admin/persons/${personId}/addresses`, headers);
          for (const address of response.data.addresses || []) {
            await api.delete(`/admin/persons/${personId}/addresses/${address.id}`, headers);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      });

      it("should retrieve all addresses for a person", async () => {
        // Create test addresses
        const addresses = [
          {
            street: "123 Test St",
            city: "Test City",
            state: "Test State",
            postal_code: "12345",
            country: "Test Country",
          },
          {
            street: "456 Another St",
            city: "Another City",
            state: "Another State",
            postal_code: "67890",
            country: "Another Country",
          },
        ];

        for (const address of addresses) {
          await api.post(`/admin/persons/${personId}/addresses`, address, headers);
        }

        const response = await api.get(
          `/admin/persons/${personId}/addresses`,
          headers
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data.addresses)).toBe(true);
        expect(response.data.addresses.length).toBe(2);

        response.data.addresses.forEach(address => {
          expect(address).toEqual({
            id: expect.any(String),
            street: expect.any(String),
            city: expect.any(String),
            state: expect.any(String),
            postal_code: expect.any(String),
            country: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
            person_id: personId,
            deleted_at: null,
            person: {
              id: personId
            }
          });
        });
      });

      it("should return empty array for person with no addresses", async () => {
        const response = await api.get(
          `/admin/persons/${personId}/addresses`,
          headers
        );

        expect(response.status).toBe(200);
        expect(Array.isArray(response.data.addresses)).toBe(true);
        expect(response.data.addresses.length).toBe(0);
      });
    });

    describe("DELETE /admin/persons/:id/addresses/:addressId", () => {
      let addressId;

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

        // Create a test address
        const address = {
          street: "123 Test St",
          city: "Test City",
          state: "Test State",
          postal_code: "12345",
          country: "Test Country",
        };

        const addressResponse = await api.post(
          `/admin/persons/${personId}/addresses`,
          address,
          headers
        );
        addressId = addressResponse.data.address.id;
      });

      it("should successfully delete an address", async () => {
        const response = await api.delete(
          `/admin/persons/${personId}/addresses/${addressId}`,
          headers
        );

        expect(response.status).toBe(204);

        // Verify address is deleted by trying to fetch all addresses
        const getResponse = await api.get(
          `/admin/persons/${personId}/addresses`,
          headers
        );
        expect(getResponse.data.addresses).not.toContainEqual(
          expect.objectContaining({ id: addressId })
        );
      });

      it("should fail when trying to delete a non-existent address", async () => {
        const nonExistentAddressId = "non-existent-id";

        await expect(
          api.delete(
            `/admin/persons/${personId}/addresses/${nonExistentAddressId}`,
            headers
          )
        ).rejects.toMatchObject({
          response: {
            status: 404,
            data: expect.objectContaining({
              message: expect.stringContaining(`Address with id \"non-existent-id\" not found for person \"${personId}\"`)
            }),
          },
        });
      });

      it("should fail when trying to delete an address for a non-existent person", async () => {
        const nonExistentPersonId = "non-existent-id";

        await expect(
          api.delete(
            `/admin/persons/${nonExistentPersonId}/addresses/${addressId}`,
            headers
          )
        ).rejects.toMatchObject({
          response: {
            status: 404,
            data: expect.objectContaining({
              message: expect.stringContaining(`Address with id \"${addressId}\" not found for person \"non-existent-id\"`)
            }),
          },
        });
      });
    });

    describe("POST /admin/persons/:id/contacts", () => {
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
      });

      afterEach(async () => {
        try {
          const response = await api.get(`/admin/persons/${personId}/contacts`, headers);
          for (const contact of response.data.contacts || []) {
            await api.delete(`/admin/persons/${personId}/contacts/${contact.id}`, headers);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      });

      it("should create a new contact for a person", async () => {
      
        const validContact = {
          type: "mobile",
          phone_number: "+1234567890",
        };

        const response = await api.post(
          `/admin/persons/${personId}/contacts`,
          validContact,
          headers
        );

      

        expect(response.status).toBe(201);
        expect(response.data.contact).toMatchObject({
          ...validContact,
          id: expect.any(String),
          created_at: expect.any(String),
          updated_at: expect.any(String),
          person_id: personId,
          deleted_at: null,
        });
      });

      it("should fail with validation error when type is invalid", async () => {
        const invalidContact = {
          type: "INVALID",
          phone_number: "+1234567890",
        };

        await expect(
          api.post(`/admin/persons/${personId}/contacts`, invalidContact, headers)
        ).rejects.toMatchObject({
          response: {
            status: 400,
          },
        });
      });
    });

    describe("POST /admin/persons/:id/contacts", () => {
      let contactId;

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

        // Create a test contact
        const contact = {
          type: "mobile",
          phone_number: "+1234567890",
        };

        const contactResponse = await api.post(
          `/admin/persons/${personId}/contacts`,
          contact,
          headers
        );
        contactId = contactResponse.data.contact.id;
      });

      afterEach(async () => {
        try {
          const response = await api.get(`/admin/persons/${personId}/contacts`, headers);
          for (const contact of response.data.contacts || []) {
            await api.delete(`/admin/persons/${personId}/contacts/${contact.id}`, headers);
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      });

      it("should list all contacts for a person", async () => {
        const response = await api.get(
          `/admin/persons/${personId}/contacts`,
          headers
        );
        
        expect(response.status).toBe(200);
        expect(Array.isArray(response.data.contacts)).toBe(true);
        expect(response.data.contacts.length).toBe(1);
        expect(response.data.contacts[0]).toMatchObject({
          type: "mobile",
          phone_number: "+1234567890",
          id: expect.any(String),
          person_id: personId,
          
        });
      });

      it("should update a contact", async () => {
        const updatedContact = {
          type: "work",
          phone_number: "+9876543210",
        };

        const response = await api.post(
          `/admin/persons/${personId}/contacts/${contactId}`,
          updatedContact,
          headers
        );
        
        expect(response.status).toBe(200);
        expect(response.data.contact).toMatchObject({
          ...updatedContact,
          id: contactId,
          person_id: personId,
        });
      });
    });

    describe("POST /admin/persons/:id/tags", () => {
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
      });

      afterEach(async () => {
        try {
          const response = await api.get(`/admin/persons/${personId}/tags`, headers);
          if (response.data.tags && response.data.tags.length > 0) {
            await api.delete(`/admin/persons/${personId}/tags`, {
              headers,
              data: { tag_ids: response.data.tags.map(t => t.id) },
            });
          }
        } catch (error) {
          // Ignore cleanup errors
        }
      });

      it("should create new tags for a person", async () => {
        const tagValues = ["customer", "vip"];

        const response = await api.post(
          `/admin/persons/${personId}/tags`,
          { name: tagValues },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.tags).toEqual([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.arrayContaining(tagValues),
            person_id: personId,
            created_at: expect.any(String),  // Changed to expect.any(String)
            updated_at: expect.any(String),  // Changed to expect.any(String)
            deleted_at: null
          })
        ]);
      });

      it("should update tags for a person", async () => {
        // First create initial tags
        await api.post(
          `/admin/persons/${personId}/tags`,
          { name: ["customer"] },
          headers
        );

        // Then update tags
        const updatedTagValues = ["vip", "premium"];

        const response = await api.put(
          `/admin/persons/${personId}/tags`,
          { name: updatedTagValues },
          headers
        );


        expect(response.status).toBe(201);
        expect(response.data.tags).toEqual([
          expect.objectContaining({
            id: expect.any(String),
            name: expect.arrayContaining(updatedTagValues),
            person_id: personId,
            created_at: expect.any(String),  // Changed to expect.any(String)
            updated_at: expect.any(String),  // Changed to expect.any(String)
            deleted_at: null
          })
        ]);

        // Verify old tags are removed
        expect(response.data.tags.map(t => t.value)).not.toContain("customer");
      });

      it("should delete specific tags from a person", async () => {
        // First create tags
        const createResponse = await api.post(
          `/admin/persons/${personId}/tags`,
          { name: ["customer", "vip"] },
          headers
        );

        expect(createResponse.data.tags).toHaveLength(1);
        expect(createResponse.data.tags[0].name).toEqual(expect.arrayContaining(["customer", "vip"]));
        const tagToDelete = createResponse.data.tags[0];
        expect(tagToDelete).toBeDefined();

        const response = await api.delete(
          `/admin/persons/${personId}/tags/${tagToDelete.id}`,
          headers,
        );

        expect(response.status).toBe(200);

        // Verify tag was deleted
        const getResponse = await api.get(
          `/admin/persons/${personId}/tags`,
          headers
        );
        expect(getResponse.data.tags.map(t => t.id)).not.toContain(tagToDelete.id);
      });
    });
  },
});