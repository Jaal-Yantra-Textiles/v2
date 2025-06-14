import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { IFileModuleService } from "@medusajs/types";
import { Modules } from "@medusajs/utils";
import FormData from "form-data";
// import { Readable } from "stream"; // No longer needed as we use File objects or Buffers with FormData

jest.setTimeout(50000); // Increased timeout for file operations

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let authConfig; // Stores authentication headers for API calls
    let fileService: IFileModuleService;
    const createdFileIds: string[] = [];
    const totalFilesToCreate = 15;

    beforeAll(async () => {
      const container = getContainer();
      await createAdminUser(container); // Ensure admin user exists
      authConfig = await getAuthHeaders(api); // Get auth config for admin
      fileService = container.resolve<IFileModuleService>(Modules.FILE); // Still needed for cleanup

      // Create multiple files for testing pagination using the /admin/uploads API
      for (let i = 0; i < totalFilesToCreate; i++) {
        const fileName = `test-editor-file-${String(i + 1).padStart(2, '0')}.txt`;
        const fileContent = `This is test content for editor file ${i + 1}.`;

        const formData = new FormData();
        // For Node.js environment in tests, providing a Buffer or Stream is common for FormData
        // Browsers would use Blob or File objects directly.
        // The 'File' class from 'buffer' or 'node:fs' might not be what Medusa's API expects directly for FormData.
        // Sending a Buffer with filename and contentType is a robust way for backend tests.
        formData.append('files', Buffer.from(fileContent), {
          filename: fileName,
          contentType: 'text/plain',
        });

        try {
          const uploadResponse = await api.post("/admin/uploads", formData, {
            // Axios (which 'api' likely uses) will set Content-Type for FormData automatically
            // but if specific headers are needed for authConfig, they should be merged.
            headers: {
              ...authConfig.headers,
              'Content-Type': formData.getHeaders()['content-type'], // Explicitly set Content-Type
            }
          });
          
          if (uploadResponse.data && Array.isArray(uploadResponse.data.files) && uploadResponse.data.files.length > 0 && uploadResponse.data.files[0].id) {
            createdFileIds.push(uploadResponse.data.files[0].id);
          } else {
            // This else block now correctly signifies a failed upload or genuinely unexpected response data
            console.error(`Upload for file ${fileName} failed or returned an unexpected data structure (expected { files: [{id: string, ...}] }):`, uploadResponse.data);
          }
        } catch (error) {
          console.error(`Error uploading file ${fileName}:`, error.response?.data || error.message);
          // Decide if test should fail here or proceed with fewer files
        }
      }
      if (createdFileIds.length !== totalFilesToCreate) {
        console.warn(`Expected to create ${totalFilesToCreate} files, but only ${createdFileIds.length} were successfully uploaded and ID'd.`);
        // This could be an assertion if strictness is required: expect(createdFileIds.length).toBe(totalFilesToCreate);
      }
      // Ensure files are sorted by creation date (newest first) for consistent pagination tests
      // The API sorts by created_at DESC. Our creation order should match this if tested immediately.
    });

    afterAll(async () => {
      // Clean up created files
      if (fileService && createdFileIds.length > 0) {
        await fileService.deleteFiles(createdFileIds);
      }
    });

    describe("GET /admin/editor-files", () => {
      it("should list files with default pagination", async () => {
        const response = await api.get("/admin/editor-files", authConfig);

        expect(response.status).toBe(200);
        expect(response.data.files).toBeInstanceOf(Array);
        // Default limit is 20, we created 15 files
        expect(response.data.files.length).toBe(Math.min(totalFilesToCreate, 20)); 
        expect(response.data.count).toBe(totalFilesToCreate);
        expect(response.data.offset).toBe(0);
        expect(response.data.limit).toBe(20); // Default limit from API route

        response.data.files.forEach(file => {
          expect(file).toHaveProperty("id");
          expect(file).toHaveProperty("url");
          expect(Object.keys(file).length).toBe(2); // Only id and url
        });
      });

      it("should list files with custom limit", async () => {
        const limit = 5;
        const response = await api.get(`/admin/editor-files?limit=${limit}`, authConfig);

        expect(response.status).toBe(200);
        expect(response.data.files).toBeInstanceOf(Array);
        expect(response.data.files.length).toBe(Math.min(limit, totalFilesToCreate));
        expect(response.data.count).toBe(totalFilesToCreate);
        expect(response.data.offset).toBe(0);
        expect(response.data.limit).toBe(limit);
      });

      it("should list files with limit and offset", async () => {
        const limit = 5;
        const offset = 5;
        const response = await api.get(`/admin/editor-files?limit=${limit}&offset=${offset}`, authConfig);

        expect(response.status).toBe(200);
        expect(response.data.files).toBeInstanceOf(Array);
        const expectedLength = Math.max(0, Math.min(limit, totalFilesToCreate - offset));
        expect(response.data.files.length).toBe(expectedLength);
        expect(response.data.count).toBe(totalFilesToCreate);
        expect(response.data.offset).toBe(offset);
        expect(response.data.limit).toBe(limit);

        if (expectedLength > 0) {
            response.data.files.forEach(file => {
                expect(file).toHaveProperty("id");
                expect(file).toHaveProperty("url");
                expect(Object.keys(file).length).toBe(2);
              });
        }
      });

      it("should handle limit greater than total files", async () => {
        const limit = totalFilesToCreate + 5;
        const response = await api.get(`/admin/editor-files?limit=${limit}`, authConfig);

        expect(response.status).toBe(200);
        expect(response.data.files).toBeInstanceOf(Array);
        expect(response.data.files.length).toBe(totalFilesToCreate);
        expect(response.data.count).toBe(totalFilesToCreate);
        expect(response.data.offset).toBe(0);
        expect(response.data.limit).toBe(limit);
      });

      it("should handle offset resulting in no files", async () => {
        const limit = 5;
        const offset = totalFilesToCreate; // Offset is total, so 0 files expected
        const response = await api.get(`/admin/editor-files?limit=${limit}&offset=${offset}`, authConfig);

        expect(response.status).toBe(200);
        expect(response.data.files).toBeInstanceOf(Array);
        expect(response.data.files.length).toBe(0);
        expect(response.data.count).toBe(totalFilesToCreate);
        expect(response.data.offset).toBe(offset);
        expect(response.data.limit).toBe(limit);
      });

      it("should return 400 for invalid limit values", async () => {
        let res = await api.get(`/admin/editor-files?limit=0`, authConfig).catch(e => e.response);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain("Limit must be between 1 and 100");

        res = await api.get(`/admin/editor-files?limit=101`, authConfig).catch(e => e.response);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain("Limit must be between 1 and 100");

        res = await api.get(`/admin/editor-files?limit=abc`, authConfig).catch(e => e.response);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain("Invalid limit or offset"); // From API route parsing
      });

      it("should return 400 for invalid offset values", async () => {
        let res = await api.get(`/admin/editor-files?offset=-1`, authConfig).catch(e => e.response);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain("Offset must be a non-negative number");

        res = await api.get(`/admin/editor-files?offset=abc`, authConfig).catch(e => e.response);
        expect(res.status).toBe(400);
        expect(res.data.message).toContain("Invalid limit or offset"); // From API route parsing
      });
    });
  },
});
