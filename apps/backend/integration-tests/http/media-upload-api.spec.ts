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

  describe("POST /admin/medias/folder", () => {
    it("should create a folder when valid body is provided", async () => {
      const response = await api.post(
        "/admin/medias/folder",
        {
          name: "Spec Test Folder",
          description: "Created from integration test",
          is_public: false,
        },
        headers
      );

      expect(response.status).toBe(201);
      expect(response.data).toHaveProperty("message", "Folder created successfully");
      expect(response.data).toHaveProperty("folder");
      const { folder } = response.data;
      expect(folder).toHaveProperty("id");
      expect(folder).toHaveProperty("name", "Spec Test Folder");
      expect(folder).toHaveProperty("slug");
      expect(folder).toHaveProperty("path");
      expect(folder).toHaveProperty("level");
    });

    it("should fail validation when name is missing", async () => {
      const response = await api
        .post(
          "/admin/medias/folder",
          {
            description: "No name provided",
          },
          headers
        )
        .catch((err) => err.response);

      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty("message");
      // Depending on validateAndTransformBody error formatting, message should include schema error
      expect(String(response.data.message).toLowerCase()).toContain("name");
    });
  });

    describe("POST /admin/medias", () => {
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
        
        // No folder fields here; API will create media without folder association

        // Get form headers
        const formHeaders = formData.getHeaders();

        // Make the API request
        const response = await api.post("/admin/medias", formData, {
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

      it("should upload a single file without folder (independent upload)", async () => {
        const fileBuffer = Buffer.from("independent upload content", "utf-8");

        const formData = new FormData();
        formData.append("files", fileBuffer, {
          filename: "independent.jpg",
          contentType: "image/jpeg",
        });

        const formHeaders = formData.getHeaders();

        const response = await api.post("/admin/medias", formData, {
          ...headers,
          headers: {
            ...headers.headers,
            ...formHeaders,
          },
        });

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty("result");
        const { result } = response.data;
        expect(result).toHaveProperty("mediaFiles");
        expect(Array.isArray(result.mediaFiles)).toBe(true);
        expect(result.mediaFiles.length).toBe(1);
        const media = result.mediaFiles[0];
        // Independent upload should not associate a folder
        expect(media.folder_id === undefined || media.folder_id === null).toBe(true);
      });

      it("should fail when no files are uploaded", async () => {
        const formData = new FormData();
        
        const formHeaders = formData.getHeaders();
        
        const response = await api
          .post("/admin/medias", formData, {
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
        const folderResponse = await api.post("/admin/medias/folder", 
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
        const response = await api.post("/admin/medias", formData, {
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

      it("should create a new folder from body and associate uploaded files", async () => {
        // Prepare a test file
        const fileBuffer = Buffer.from("content for inline folder upload", "utf-8");

        // Build multipart form data with files and a folder object in body
        const formData = new FormData();
        formData.append("files", fileBuffer, {
          filename: "inline-folder.jpg",
          contentType: "image/jpeg",
        });
        // Pass folder as JSON string so validator can parse
        formData.append(
          "folder",
          JSON.stringify({
            name: "Inline Created Folder",
            description: "Folder provided in upload body",
          })
        );

        const formHeaders = formData.getHeaders();

        const response = await api.post("/admin/medias", formData, {
          ...headers,
          headers: {
            ...headers.headers,
            ...formHeaders,
          },
        });

        expect(response.status).toBe(201);
        expect(response.data).toHaveProperty("result");
        const { result } = response.data;

        // Folder should be created and returned by workflow result
        expect(result).toHaveProperty("folder");
        expect(result.folder).toBeTruthy();
        expect(result.folder).toHaveProperty("id");
        expect(result.folder).toHaveProperty("name", "Inline Created Folder");

        // Media files should be uploaded and associated to the newly created folder
        expect(Array.isArray(result.mediaFiles)).toBe(true);
        expect(result.mediaFiles.length).toBe(1);
        const media = result.mediaFiles[0];
        expect(media).toHaveProperty("folder_id", result.folder.id);
      });
    });
});
