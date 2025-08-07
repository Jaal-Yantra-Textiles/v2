
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
    let headers;
    let websiteId;
    let pageId;
    const api = getSharedTestEnv().api;
    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv();
      await createAdminUser(getContainer());
      headers = await getAuthHeaders(api);

      // Create a test website
      const newWebsite = {
        domain: "test.example.com",
        name: "Test Website",
        description: "A test website",
        status: "Development",
        primary_language: "en",
      };

      const websiteResponse = await api.post("/admin/websites", newWebsite, headers);
      websiteId = websiteResponse.data.website.id;

      // Create a test page
      const newPage = {
        title: "Test Page",
        slug: "test-page",
        content: "Test content",
        page_type: "Custom",
        status: "Published",
      };

      const pageResponse = await api.post(
        `/admin/websites/${websiteId}/pages`,
        newPage,
        headers
      );
      pageId = pageResponse.data.page.id;
    });

    describe("Block CRUD Operations", () => {
      describe("POST /admin/websites/:id/pages/:pageId/blocks", () => {
        it("should create a unique block successfully", async () => {
          const newBlock = {
            name: "Main Hero",
            type: "Hero",
            content: { title: "Welcome", subtitle: "To our website" },
            settings: { background: "dark" },
            status: "Active",
            order: 0,
            metadata: { custom: "value" }
          };

          const response = await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            { blocks: [newBlock] },
            headers
          );

          expect(response.status).toBe(201);
          expect(response.data.blocks).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                ...newBlock,
                id: expect.any(String),
                created_at: expect.any(String)
              })
            ])
          )
        });

        it("should fail to create duplicate unique block", async () => {
          const heroBlock = {
            name: "Main Hero",
            type: "Hero",
            content: { title: "Welcome" },
            status: "Active"
          };

          // Create first Hero block
          await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            {blocks: [heroBlock]},
            headers
          );

          // Try to create another Hero block
          const duplicateResponse = await api
            .post(
              `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
              {blocks: [heroBlock]},
              headers
            )
            .catch((e) => e.response);
          
          expect(duplicateResponse.status).toBe(400);
         
          expect(duplicateResponse.data.errors[0].error).toContain("Hero, already exists");
        });

        it("should create multiple repeatable blocks", async () => {
          const featureBlock = {
            name: "Feature Block",
            type: "Feature",
            content: { title: "Feature" },
            status: "Active"
          };

          // Create multiple Feature blocks
          const response1 = await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            { blocks: [featureBlock] },
            headers
          );

          const response2 = await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            { blocks: [{...featureBlock, name: "Feature Block 2"}] },
            headers
          );

        

          expect(response1.status).toBe(201);
          expect(response2.status).toBe(201);
        });

        it("should create multiple blocks in batch", async () => {
          const batchBlocks = {
            blocks: [
              {
                name: "Hero Section",
                type: "Hero",
                content: { title: "Welcome" },
                status: "Active"
              },
              {
                name: "Feature 1",
                type: "Feature",
                content: { title: "Feature 1" },
                status: "Active"
              },
              {
                name: "Feature 2",
                type: "Feature",
                content: { title: "Feature 2" },
                status: "Active"
              },
            ],
          };

          const response = await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            batchBlocks,
            headers
          );
          expect(response.status).toBe(201);
          expect(response.data.blocks).toHaveLength(3);
          expect(response.data.blocks).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: "Hero Section",
                type: "Hero",
              }),
              expect.objectContaining({
                name: "Feature 1",
                type: "Feature",
              }),
              expect.objectContaining({
                name: "Feature 2",
                type: "Feature",
              }),
            ])
          );
        });

        it("should handle partial success in batch creation", async () => {
          // First create a Hero block
          await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
           { blocks:
            [{
              name: "Hero Section",
              type: "Hero",
              content: { title: "Welcome" },
              status: "Active"
            }]
          },
            headers
          );

          // Try to create batch with duplicate Hero and new Feature blocks
          const batchBlocks = {
            blocks: [
              {
                name: "Duplicate Hero",
                type: "Hero",
                content: { title: "Welcome" },
                status: "Active"
              },
              {
                name: "Feature 1",
                type: "Feature",
                content: { title: "Feature 1" },
                status: "Active"
              },
            ],
          };

          const response = await api
            .post(
              `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
              batchBlocks,
              headers
            )
            .catch((e) => e.response);

          expect(response.status).toBe(207);
          expect(response.data.blocks).toHaveLength(1); // Only Feature block created
          expect(response.data.errors).toHaveLength(1); // Hero block error
        });
      });

      describe("GET /admin/websites/:id/pages/:pageId/blocks", () => {
        beforeEach(async () => {
          // Create test blocks
          await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            {
              blocks: [
                {
                  name: "Hero Section",
                  type: "Hero",
                  content: { title: "Welcome" },
                  status: "Active"
                },
                {
                  name: "Feature 1",
                  type: "Feature",
                  content: { title: "Feature 1" },
                  status: "Active"
                },
              ],
            },
            headers
          );
        });

        it("should list all blocks with pagination", async () => {
          const response = await api.get(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            {
              ...headers,
              params: {
                config: {
                  take: 10,
                  skip: 0
                }
              }
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.blocks).toHaveLength(2);
          expect(response.data.count).toBe(2);
          expect(response.data.limit).toBe(10);
          expect(response.data.offset).toBe(0);
        });

        it("should filter blocks by type and status", async () => {
          const response = await api.get(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            {
              ...headers,
              params: {
                filters: { 
                  type: "Hero",
                  status: "Active"
                }
              }
            }
          );
          expect(response.status).toBe(200);
          expect(response.data.blocks).toHaveLength(1);
          expect(response.data.blocks[0].type).toBe("Hero");
          expect(response.data.blocks[0].status).toBe("Active");
        });
      });

      describe("PUT /admin/websites/:id/pages/:pageId/blocks/:blockId", () => {
        let blockId;

        beforeEach(async () => {
          const response = await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            { blocks: [{
              name: "Test Block",
              type: "Feature",
              content: { title: "Original" },
              status: "Active"
            }]},
            headers
          );
          blockId = response.data.blocks[0].id;
        });

        it("should update block content and settings", async () => {
          const updateData = {
            content: { title: "Updated" },
            name: "Updated Block",
            settings: { theme: "dark" },
            status: "Draft"
          };

          const response = await api.put(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
            updateData,
            headers
          );

          expect(response.status).toBe(200);
          expect(response.data).toMatchObject({
            content: updateData.content,
            name: updateData.name,
            settings: updateData.settings,
            status: updateData.status
          });
        });

        it("should not allow changing type to existing unique block type", async () => {
          // First create a Hero block
          await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            {blocks: [{
              name: "Hero Block",
              type: "Hero",
              content: { title: "Hero" },
              status: "Active"
            }]},
            headers
          );

          // Try to change Feature block to Hero
          const response = await api
            .put(
              `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
              {
                type: "Hero"
              },
              headers
            )
            .catch((e) => e.response);

          expect(response.status).toBe(400);
          expect(response.data.message).toContain("A block of type Hero already exists for this page");
        });
      });

      describe("DELETE /admin/websites/:id/pages/:pageId/blocks/:blockId", () => {
        let blockId;

        beforeEach(async () => {
          const response = await api.post(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
            {blocks: [{
              name: "Test Block",
              type: "Feature",
              content: { title: "To Delete" },
              status: "Active"
            }]},
            headers
          );
          blockId = response.data.blocks[0].id;
        });

        it("should delete block", async () => {
          const response = await api.delete(
            `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
            headers
          );
          

          expect(response.status).toBe(200);
          expect(response.data.deleted).toBe(true);

          // Verify block is deleted
          const getResponse = await api
            .get(
              `/admin/websites/${websiteId}/pages/${pageId}/blocks/${blockId}`,
              headers
            )
            .catch((e) => e.response);
          expect(getResponse.status).toBe(404);
        });
      });
    });
});
