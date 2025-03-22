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
        "id,first_name,last_name,email,phone,date_of_birth,tags,person_types",
        ",John,Doe,john.doe@example.com,+1234567890,1990-01-01,\"Supplier,Important\",\"Customer\"",
        ",Jane,Smith,jane.smith@example.com,+0987654321,1985-05-15,\"Partner\",\"Vendor,VIP\"",
        // Add a record that will be updated (you'd need to create this person first in the beforeEach)
        "{EXISTING_PERSON_ID},Updated,Person,updated.person@example.com,+1122334455,1975-03-20,\"Important\",\"Customer,VIP\"",
      ].join("\n");

      fs.writeFileSync(csvFilePath, csvContent);
    });

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

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
        await new Promise(resolve => setTimeout(resolve, 3000));

        // 4. Verify the imported persons
        const personsResponse = await api.get("/admin/persons", headers);
        
        expect(personsResponse.status).toBe(200);
        console.log(personsResponse.data)
        
        // Verify John Doe was created
        const johnDoe = personsResponse.data.persons.find(
          (p) => p.email === "john.doe@example.com"
        );
        expect(johnDoe).toBeDefined();
        expect(johnDoe.first_name).toBe("John");
        expect(johnDoe.last_name).toBe("Doe");
        
        // Verify Jane Smith was created
        const janeSmith = personsResponse.data.persons.find(
          (p) => p.email === "jane.smith@example.com"
        );
        expect(janeSmith).toBeDefined();
        expect(janeSmith.first_name).toBe("Jane");
        expect(janeSmith.last_name).toBe("Smith");
        
        // Verify the Existing Person was updated
        const updatedPerson = personsResponse.data.persons.find(
          (p) => p.email === "updated.person@example.com"
        );
        expect(updatedPerson).toBeDefined();
        expect(updatedPerson.first_name).toBe("Updated");
        expect(updatedPerson.last_name).toBe("Person");
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
