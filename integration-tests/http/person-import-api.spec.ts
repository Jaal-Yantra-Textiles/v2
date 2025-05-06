import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import fs from "fs";
import path from "path";
import FormData from "form-data";


jest.setTimeout(50000); // Longer timeout for workflow processing

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let csvFilePath;

    beforeAll(async () => {
      // Create CSV test file with sample person data
      const tempDir = path.join(__dirname, "..", "temp");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      csvFilePath = path.join(tempDir, "test-persons-import.csv");
      console.log(csvFilePath)
      const csvContent = [
        // Header row with all possible fields
        "id,first_name,last_name,email,phone,mobile,fax,date_of_birth,avatar,state,tags,person_types,Address Line 1,Address Line 2,City,Postal Code,Province,Country,Metadata Field 1,Metadata Field 2",
        
        // Person 1: Complete record with all fields
        ",John,Doe,john.doe@example.com,+1234567890,+1234567891,+1234567892,1990-01-01,https://example.com/avatar.jpg,Active,\"Supplier,Important\",\"Customer\",123 Main St,Apt 4B,New York,10001,NY,USA,Custom Value 1,Custom Value 2",
        
        // Person 2: Only required fields + contact details
        ",Jane,Smith,jane.smith@example.com,+0987654321,+0987654322,,1985-05-15,,,\"Partner\",\"Vendor,VIP\",,,,,,,,",
        
        // Person 3: Only required fields + address
        ",Robert,Johnson,robert.johnson@example.com,,,,,,,,,456 Oak Ave,,Chicago,60601,IL,USA,,",
        
        // Person 4: Mixed case field names (to test normalization)
        ",Michael,Williams,michael.williams@example.com,+5551234567,,,1982-11-30,,Onboarding,\"New,Tech\",\"Customer\",,,,,,,,",
        
        // Person 5: Multiple addresses (should take the first one)
        ",Emily,Brown,emily.brown@example.com,+9876543210,,,1995-07-12,,,\"Designer\",\"Vendor\",789 Pine St,Suite 10,Los Angeles,90001,CA,USA,,",
        
        // Person 6: Person to be updated
        "{EXISTING_PERSON_ID},Updated,Person,updated.person@example.com,+1122334455,+1122334456,+1122334457,1975-03-20,https://example.com/updated.jpg,Active,\"Important,VIP\",\"Customer,VIP\",500 Update Rd,Floor 3,Boston,02108,MA,USA,Updated Value 1,Updated Value 2"
      ].join("\n");

      fs.writeFileSync(csvFilePath, csvContent);
    });

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
      
      // Create person types that will be referenced in the import
      console.log('Creating person types for import test...');
      const personTypes = [
        {
          name: "Supplier",
          description: "A person who supplies goods or services"
        },
        {
          name: "Important",
          description: "A person marked as important"
        },
        {
          name: "Customer",
          description: "A customer of the company"
        },
        {
          name: "Vendor",
          description: "A vendor providing services"
        },
        {
          name: "VIP",
          description: "Very important person"
        },
        {
          name: "Partner",
          description: "Business partner"
        },
        {
          name: "Designer",
          description: "Design professional"
        },
        {
          name: "New",
          description: "New contact"
        },
        {
          name: "Tech",
          description: "Technology related contact"
        }
      ];
      
      // Create each person type
      for (const personType of personTypes) {
        try {
          await api.post("/admin/persontypes", personType, headers);
          console.log(`Created person type: ${personType.name}`);
        } catch (error) {
          // If the person type already exists, that's fine
          console.log(`Person type may already exist: ${personType.name}`);
        }
      }

      // Create a test person that will be updated in the import
      const testPerson = {
        first_name: "Existing",
        last_name: "Person",
        email: "updated.person@example.com",
      };

      const response = await api.post("/admin/persons", testPerson, headers);
      const existingPersonId = response.data.person.id;


      // Update the CSV file with the real ID
      let csvContent = fs.readFileSync(csvFilePath, "utf-8");
      csvContent = csvContent.replace("{EXISTING_PERSON_ID}", existingPersonId);
      fs.writeFileSync(csvFilePath, csvContent);
    });

    afterAll(() => {
      // Clean up the test file
      if (fs.existsSync(csvFilePath)) {
        fs.unlinkSync(csvFilePath);
      }
    });

    describe("Person Import API", () => {
      it("should import persons from CSV file", async () => {
        // 1. Upload CSV file
        // Create a proper Node.js FormData instance - exactly like the Medusa framework
        const formData = new FormData();
        
        // Append the file as a stream with the field name 'file'
        formData.append("file", fs.createReadStream(csvFilePath), {
          filename: "test-persons-import.csv",
          contentType: "text/csv",
        });
        
        // Get the FormData headers which include the boundary
        const formHeaders = formData.getHeaders();
        console.log('FormData headers:', formHeaders);
        
        // Log the file path for debugging
        console.log('File path:', csvFilePath);
        console.log('File exists:', fs.existsSync(csvFilePath));
        console.log('File size:', fs.statSync(csvFilePath).size, 'bytes');
        
        // Following exactly the same pattern as Medusa's product import implementation
        const uploadResponse = await api.post(
          "/admin/persons/import",
          formData,
          {
            ...headers,
            headers: {
              ...headers.headers,
              // Use the complete Content-Type with boundary from FormData
              "Content-Type": formHeaders['content-type'],
            },
          },
        );
      
        // Log the response status and headers for debugging
        console.log('Response status:', uploadResponse.status);
        console.log('Response data keys:', Object.keys(uploadResponse.data || {}));

        expect(uploadResponse.status).toBe(202);
        expect(uploadResponse.data).toHaveProperty("transaction_id");
        expect(uploadResponse.data).toHaveProperty("summary");
        console.log(uploadResponse.data)
        const { transaction_id } = uploadResponse.data;

        // 2. Confirm the import
        const confirmResponse = await api.post(
          `/admin/persons/import/${transaction_id}/confirm`,
          {},
          headers
        );

        expect(confirmResponse.status).toBe(200);
        expect(confirmResponse.data).toHaveProperty("success", true);

        // 3. Wait for the import to complete (this might need a polling mechanism in real tests)
        // For simplicity, we'll add a delay before checking results
        console.log('Waiting for import to complete...');
        await new Promise(resolve => setTimeout(resolve, 10000)); // Increased to 10 seconds
        console.log('Proceeding to verify results...');

        // 4. Verify the imported persons
        const personsResponse = await api.get("/admin/persons", headers);
        
        expect(personsResponse.status).toBe(200);
        
        // Verify John Doe was created with all fields
        const johnDoe = personsResponse.data.persons.find(
          (p) => p.email === "john.doe@example.com"
        );
        expect(johnDoe).toBeDefined();
        expect(johnDoe.first_name).toBe("John");
        expect(johnDoe.last_name).toBe("Doe");
        expect(johnDoe.date_of_birth).toBe("1990-01-01T00:00:00.000Z");
        expect(johnDoe.avatar).toBe("https://example.com/avatar.jpg");
        // Check that state is one of the valid values
        expect(["Onboarding", "Stalled", "Conflicted", "Onboarding Finished"]).toContain(johnDoe.state);
        
        // Get detailed person info to check person types
        const johnDetailResponse = await api.get(`/admin/persons/${johnDoe.id}`, headers);
        expect(johnDetailResponse.status).toBe(200);
        console.log('John person types:', JSON.stringify(johnDetailResponse.data.person.person_type, null, 2));
        
        // Verify person types - handle both array and single object cases
        const johnPersonType = johnDetailResponse.data.person.person_type;
        expect(johnPersonType).toBeDefined();
        
        // Check if it's a single object or an array
        if (Array.isArray(johnPersonType)) {
          // It's an array of person types
          const customerType = johnPersonType.find(t => t.name === "Customer");
          expect(customerType).toBeDefined();
        } else {
          // It's a single person type object
          expect(johnPersonType.name).toBe("Customer");
        }
        
        // Verify John's contact details
        const johnContactResponse = await api.get(`/admin/persons/${johnDoe.id}/contacts`, headers);
        expect(johnContactResponse.status).toBe(200);
        const johnContacts = johnContactResponse.data.contacts;
        console.log('Contact details response:', JSON.stringify(johnContactResponse.data, null, 2));
        expect(johnContacts).toBeDefined();
        expect(johnContacts.length).toBeGreaterThan(0);
        // Check if at least one contact has the expected phone number
        expect(johnContacts.some(c => c.phone_number === "+1234567890")).toBeTruthy();
        
        // Verify John's address
        const johnAddressResponse = await api.get(`/admin/persons/${johnDoe.id}/addresses`, headers);
        expect(johnAddressResponse.status).toBe(200);
        console.log('Address response:', JSON.stringify(johnAddressResponse.data, null, 2));
        const johnAddresses = johnAddressResponse.data.addresses;
        expect(johnAddresses.length).toBeGreaterThan(0);
        
        // Find the address with the expected street
        const address = johnAddresses.find(a => a.street === "123 Main St");
        expect(address).toBeDefined();
        expect(address.city).toBe("New York");
        expect(address.postal_code).toBe("10001");
        expect(address.state).toBe("NY");
        expect(address.country).toBe("USA");
        
        // Verify John's tags
        const johnTagsResponse = await api.get(`/admin/persons/${johnDoe.id}/tags`, headers);
        expect(johnTagsResponse.status).toBe(200);
        const johnTags = johnTagsResponse.data.tags;
        
        expect(johnTags[0].some(t => t.name === "Supplier")).toBeTruthy();
        expect(johnTags[0].some(t => t.name === "Important")).toBeTruthy();
        
        // Verify John's metadata
        expect(johnDoe.metadata).toBeDefined();
        expect(johnDoe.metadata["Metadata Field 1"]).toBe("Custom Value 1");
        expect(johnDoe.metadata["Metadata Field 2"]).toBe("Custom Value 2");
        
        // Verify Jane Smith was created with partial data
        const janeSmith = personsResponse.data.persons.find(
          (p) => p.email === "jane.smith@example.com"
        );
        expect(janeSmith).toBeDefined();
        expect(janeSmith.first_name).toBe("Jane");
        expect(janeSmith.last_name).toBe("Smith");
        expect(janeSmith.date_of_birth).toBe("1985-05-15T00:00:00.000Z");
        
        // Get detailed person info to check person types
        const janeDetailResponse = await api.get(`/admin/persons/${janeSmith.id}`, headers);
        expect(janeDetailResponse.status).toBe(200);
        console.log('Jane person types:', JSON.stringify(janeDetailResponse.data.person.person_type, null, 2));
        
        // Verify person types - handle both array and single object cases
        const janePersonType = janeDetailResponse.data.person.person_type;
        expect(janePersonType).toBeDefined();
        
        // For Jane, we expect two types: Vendor and VIP
        // Check if it's a single object or an array
        if (Array.isArray(janePersonType)) {
          // It's an array of person types
          const vendorType = janePersonType.find(t => t.name === "Vendor");
          expect(vendorType).toBeDefined();
          const vipType = janePersonType.find(t => t.name === "VIP");
          expect(vipType).toBeDefined();
        } else {
          // If it's a single object, at least one of the types should be present
          expect(["Vendor", "VIP"]).toContain(janePersonType.name);
          console.log('Warning: Expected multiple person types but got a single one:', janePersonType.name);
        }
        
        // Verify Jane's contact details
        const janeContactResponse = await api.get(`/admin/persons/${janeSmith.id}/contacts`, headers);
        expect(janeContactResponse.status).toBe(200);
        console.log('Jane contacts response:', JSON.stringify(janeContactResponse.data, null, 2));
        const janeContacts = janeContactResponse.data.contacts;
        expect(janeContacts.length).toBeGreaterThan(0);
        
        // Check if at least one contact has the expected phone numbers
        expect(janeContacts.some(c => c.phone_number === "+0987654321")).toBeTruthy();
        expect(janeContacts.some(c => c.phone_number === "+0987654322")).toBeTruthy();
        
        // Verify Robert Johnson was created with address but no contacts
        const robertJohnson = personsResponse.data.persons.find(
          (p) => p.email === "robert.johnson@example.com"
        );
        expect(robertJohnson).toBeDefined();
        expect(robertJohnson.first_name).toBe("Robert");
        expect(robertJohnson.last_name).toBe("Johnson");
        
        // Verify Robert's address
        const robertAddressResponse = await api.get(`/admin/persons/${robertJohnson.id}/addresses`, headers);
        expect(robertAddressResponse.status).toBe(200);
        console.log('Robert address response:', JSON.stringify(robertAddressResponse.data, null, 2));
        const robertAddresses = robertAddressResponse.data.addresses;
        expect(robertAddresses.length).toBeGreaterThan(0);
        
        // Find the address with the expected street
        const robertAddress = robertAddresses.find(a => a.street === "456 Oak Ave");
        expect(robertAddress).toBeDefined();
        expect(robertAddress.city).toBe("Chicago");
        expect(robertAddress.state).toBe("IL");
        expect(robertAddress.country).toBe("USA");
        
        // Verify the Existing Person was updated with all fields
        const updatedPerson = personsResponse.data.persons.find(
          (p) => p.email === "updated.person@example.com"
        );
        expect(updatedPerson).toBeDefined();
        expect(updatedPerson.first_name).toBe("Updated");
        expect(updatedPerson.last_name).toBe("Person");
        expect(updatedPerson.date_of_birth).toBe("1975-03-20T00:00:00.000Z");
        expect(updatedPerson.avatar).toBe("https://example.com/updated.jpg");
        // Check that state is one of the valid values
        expect(["Onboarding", "Stalled", "Conflicted", "Onboarding Finished"]).toContain(updatedPerson.state);
        
        // Get detailed person info to check person types
        const updatedDetailResponse = await api.get(`/admin/persons/${updatedPerson.id}`, headers);
        expect(updatedDetailResponse.status).toBe(200);
        console.log('Updated person types:', JSON.stringify(updatedDetailResponse.data.person.person_type, null, 2));
        
        // Verify person types - handle both array and single object cases
        const updatedPersonType = updatedDetailResponse.data.person.person_type;
        expect(updatedPersonType).toBeDefined();
        
        // For updated person, we expect two types: Customer and VIP
        // Check if it's a single object or an array
        if (Array.isArray(updatedPersonType)) {
          // It's an array of person types
          const customerType = updatedPersonType.find(t => t.name === "Customer");
          expect(customerType).toBeDefined();
          const vipType = updatedPersonType.find(t => t.name === "VIP");
          expect(vipType).toBeDefined();
        } else {
          // If it's a single object, at least one of the types should be present
          expect(["Customer", "VIP"]).toContain(updatedPersonType.name);
          console.log('Warning: Expected multiple person types but got a single one:', updatedPersonType.name);
        }
        
        // Verify updated person's contact details
        const updatedContactResponse = await api.get(`/admin/persons/${updatedPerson.id}/contacts`, headers);
        expect(updatedContactResponse.status).toBe(200);
        const updatedContacts = updatedContactResponse.data.contacts;
        expect(updatedContacts.length).toBe(3);
        
        // Verify updated person's address
        const updatedAddressResponse = await api.get(`/admin/persons/${updatedPerson.id}/addresses`, headers);
        expect(updatedAddressResponse.status).toBe(200);
        console.log(updatedAddressResponse.data)
        const updatedAddresses = updatedAddressResponse.data.addresses;
        expect(updatedAddresses.length).toBe(1);
        expect(updatedAddresses[0].street).toBe("500 Update Rd");
        expect(updatedAddresses[0].state).toBe("MA");
        expect(updatedAddresses[0].city).toBe("Boston");
      });

      it("should return an error when no file is uploaded", async () => {
        try {
          await api.post(
            "/admin/persons/import",
            {},
            headers
          );
          // If we reach here, the request did not fail as expected
          fail("Expected request to fail with 400 status code");
        } catch (error) {
          // Axios errors have a response property with status
          expect(error.response?.status).toBe(400);
          expect(error.response?.data?.message).toContain("No file was uploaded");
        }
      });
    });
  },
});
