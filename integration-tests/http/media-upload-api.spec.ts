import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import FormData from "form-data";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(30000);

setupSharedTestSuite(() => {
    let headers;
    const { api, getContainer } = getSharedTestEnv();
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
    });

    describe("POST /admin/media", () => {
      it("should upload media files successfully", async () => {
        // Create test files as buffers
        const file1Buffer = Buffer.from("This is test image 1 content", "utf-8");
        const file2Buffer = Buffer.from("This is test image 2 content", "utf-8");

        // Create FormData with multiple files
        const formData = new FormData();
        formData.append("files", file1Buffer, {
          filename: "test-image-1.jpg",
          contentType: "image/jpeg",
        });
        formData.append("files", file2Buffer, {
          filename: "test-image-2.png",
          contentType: "image/png",
        });
        
        // Add optional parameters
        // Add folder creation parameters
        // Note: Form data with nested fields like folder[name] may not be parsed correctly by default
        // We'll need to handle this properly in our middleware or use a different approach
        formData.append("folder[name]", "Test Folder");
        formData.append("folder[description]", "A test folder for media uploads");

        // Get form headers
        const formHeaders = formData.getHeaders();

        // Make the API request
        const response = await api.post("/admin/media", formData, {
          ...headers,
          headers: {
            ...headers.headers,
            ...formHeaders,
          },
        });

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty("message");
        expect(response.data).toHaveProperty("result");
        
        // Verify the result structure
        const { result } = response.data;
        expect(result).toHaveProperty("mediaFiles");
        expect(Array.isArray(result.mediaFiles)).toBe(true);
        expect(result.mediaFiles.length).toBe(2);
        
        // Verify each media file has required properties
        result.mediaFiles.forEach((mediaFile: any) => {
          expect(mediaFile).toHaveProperty("id");
          expect(mediaFile).toHaveProperty("file_name");
          expect(mediaFile).toHaveProperty("file_path");
          expect(mediaFile).toHaveProperty("file_type");
        });
      });

      it("should fail when no files are uploaded", async () => {
        const formData = new FormData();
        formData.append("folder[name]", "Test Folder");
        
        const formHeaders = formData.getHeaders();
        
        const response = await api
          .post("/admin/media", formData, {
            ...headers,
            headers: {
              ...headers.headers,
              ...formHeaders,
            },
          })
          .catch((err) => err.response);

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("No files were uploaded");
      });

      it("should upload files with existing folder and album", async () => {
        // First, create a folder using the folder API
        const folderResponse = await api.post("/admin/media/folder", 
          {
            name: "Test Existing Folder",
            description: "A test folder created via API"
          },
          headers
        );
        
        expect(folderResponse.status).toBe(201);
        expect(folderResponse.data).toHaveProperty("folder");
        expect(folderResponse.data.folder).toHaveProperty("id");
        
        const createdFolderId = folderResponse.data.folder.id;
        
        // Create test file
        const fileBuffer = Buffer.from("This is test image content", "utf-8");

        // Create FormData
        const formData = new FormData();
        formData.append("files", fileBuffer, {
          filename: "test-image.jpg",
          contentType: "image/jpeg",
        });
        
        // Add existing folder ID (now a real ID)
        formData.append("existingFolderId", createdFolderId);

        const formHeaders = formData.getHeaders();

        // Make the API request
        const response = await api.post("/admin/media", formData, {
          ...headers,
          headers: {
            ...headers.headers,
            ...formHeaders,
          },
        });

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty("result");
        expect(response.data.result).toHaveProperty("mediaFiles");
        expect(Array.isArray(response.data.result.mediaFiles)).toBe(true);
        expect(response.data.result.mediaFiles.length).toBe(1);
        
        // Verify the media file is associated with the correct folder
        const mediaFile = response.data.result.mediaFiles[0];
        expect(mediaFile).toHaveProperty("folder_id", createdFolderId);
      });
    });
});
