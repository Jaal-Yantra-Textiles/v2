import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import PersonService from "../../src/modules/person/service";
import { PERSON_MODULE } from "../../src/modules/person";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(100000);

medusaIntegrationTestRunner({
  testSuite: ({ getContainer, api }) => {
    let personService: PersonService;
    let headers;

    beforeEach(async () => {
      const container = getContainer();
      personService = container.resolve<PersonService>(PERSON_MODULE);
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
      
      const persons = await personService.listPeople();
      if (persons.length) {
        await personService.deletePeople(persons.map(p => p.id));
      }

      for (let i = 0; i < 10; i++) {
        const personResponse = await api.post(
          "/admin/persons",
          {
            first_name: `FirstName${i}`,
            last_name: `LastName${i}`,
            email: `test${i}@example.com`,
          },
          headers
        );
        const person = personResponse.data.person;

        await api.post(
          `/admin/persons/${person.id}/addresses`,
          {
            street: `${i} Test Street`,
            city: "Testville",
            state: "TS",
            postal_code: `${10000 + i}`,
            country: "Testland",
            latitude: 34.0522 + i * 0.01,
            longitude: -118.2437 + i * 0.01,
          },
          headers
        );
      }
    });

    it("should list all public persons with correct data", async () => {
      const response = await api.get("/web/persons");

      expect(response.status).toBe(200);
      expect(response.data.persons.length).toBe(10);
      expect(response.data.count).toBe(10);

      const firstPerson = response.data.persons[0];
      expect(firstPerson).toHaveProperty("id");
      expect(firstPerson).toHaveProperty("first_name");
      expect(firstPerson).toHaveProperty("last_name");
      expect(firstPerson).toHaveProperty("addresses");
      expect(firstPerson.addresses[0]).toHaveProperty("latitude");
      expect(firstPerson.addresses[0]).toHaveProperty("longitude");
      expect(firstPerson).not.toHaveProperty("email");
    });

    it("should handle pagination correctly", async () => {
      const response = await api.get("/web/persons?limit=5&offset=2");

      expect(response.status).toBe(200);
      expect(response.data.persons.length).toBe(5);
      expect(response.data.count).toBe(10);
      expect(response.data.offset).toBe(2);
      expect(response.data.limit).toBe(5);
    });

    it("should filter persons by search query", async () => {
      const response = await api.get("/web/persons?q=FirstName3");

      expect(response.status).toBe(200);
      expect(response.data.persons.length).toBe(1);
      expect(response.data.persons[0].first_name).toBe("FirstName3");
    });
  },
});
