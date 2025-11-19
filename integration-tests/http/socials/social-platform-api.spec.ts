import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup";

jest.setTimeout(60000);

setupSharedTestSuite(() => {
  let headers;
  const { api, getContainer } = getSharedTestEnv();

  beforeEach(async () => {
    await createAdminUser(getContainer());
    headers = await getAuthHeaders(api);
  });

  describe("Social Platform API", () => {
      describe("Basic CRUD Operations", () => {
        it("should perform full CRUD for a social platform", async () => {
          // 1. Create
          const createPayload = {
            name: "Test Platform",
          };
          const createResponse = await api.post(
            "/admin/social-platforms",
            createPayload,
            headers
          );
          expect(createResponse.status).toBe(201);
          expect(createResponse.data.socialPlatform).toBeDefined();
          const createdId = createResponse.data.socialPlatform.id;
          expect(createdId).not.toBeNull();

          // 2. Get
          const getResponse = await api.get(
            `/admin/social-platforms/${createdId}`,
            headers
          );
          expect(getResponse.status).toBe(200);
          expect(getResponse.data.socialPlatform.id).toEqual(createdId);

          // 3. Update
          const updatePayload = {
            name: "Updated Platform",
          };
          const updateResponse = await api.post(
            `/admin/social-platforms/${createdId}`,
            updatePayload,
            headers
          );
          expect(updateResponse.status).toBe(200);
          expect(updateResponse.data.socialPlatform.name).toEqual("Updated Platform");

          // 4. List
          const listResponse = await api.get(`/admin/social-platforms`, adminHeaders);
          expect(listResponse.status).toBe(200);
          expect(listResponse.data.socialPlatforms).toBeInstanceOf(Array);

          // 5. Delete
          const deleteResponse = await api.delete(
            `/admin/social-platforms/${createdId}`,
            headers
          );
          expect(deleteResponse.status).toBe(200);
          expect(deleteResponse.data).toEqual({
            id: createdId,
            object: "social_platform",
            deleted: true,
          });

          // 6. Verify Deletion
          await api.get(`/admin/social-platforms/${createdId}`, adminHeaders).catch((err) => {
            expect(err.response.status).toBe(404);
          });
        });
      });

      describe("Extended Fields", () => {
        it("should create platform with all extended fields", async () => {
          const createPayload = {
            name: "Facebook",
            category: "social",
            auth_type: "oauth2",
            icon_url: "https://example.com/facebook.png",
            base_url: "https://graph.facebook.com",
            description: "Facebook social media platform",
            status: "active",
            metadata: {
              api_version: "v21.0",
              features: ["posts", "pages", "insights"],
            },
          };

          const createResponse = await api.post(
            "/admin/social-platforms",
            createPayload,
            headers
          );

          expect(createResponse.status).toBe(201);
          const platform = createResponse.data.socialPlatform;

          expect(platform.name).toBe("Facebook");
          expect(platform.category).toBe("social");
          expect(platform.auth_type).toBe("oauth2");
          expect(platform.icon_url).toBe("https://example.com/facebook.png");
          expect(platform.base_url).toBe("https://graph.facebook.com");
          expect(platform.description).toBe("Facebook social media platform");
          expect(platform.status).toBe("active");
          expect(platform.metadata).toEqual({
            api_version: "v21.0",
            features: ["posts", "pages", "insights"],
          });

          // Cleanup
          await api.delete(`/admin/social-platforms/${platform.id}`, adminHeaders);
        });

        it("should update platform extended fields", async () => {
          // Create platform
          const createResponse = await api.post(
            "/admin/social-platforms",
            { name: "Twitter" },
            headers
          );
          const platformId = createResponse.data.socialPlatform.id;

          // Update with extended fields
          const updatePayload = {
            category: "social",
            auth_type: "oauth2",
            description: "Twitter/X social media platform",
            status: "active",
            metadata: { api_version: "2.0" },
          };

          const updateResponse = await api.post(
            `/admin/social-platforms/${platformId}`,
            updatePayload,
            headers
          );

          expect(updateResponse.status).toBe(200);
          const platform = updateResponse.data.socialPlatform;

          expect(platform.category).toBe("social");
          expect(platform.auth_type).toBe("oauth2");
          expect(platform.description).toBe("Twitter/X social media platform");
          expect(platform.status).toBe("active");
          expect(platform.metadata).toEqual({ api_version: "2.0" });

          // Cleanup
          await api.delete(`/admin/social-platforms/${platformId}`, adminHeaders);
        });
      });

      describe("Category Filtering", () => {
        beforeEach(async () => {
          // Create platforms with different categories
          await api.post(
            "/admin/social-platforms",
            { name: "Facebook", category: "social" },
            headers
          );
          await api.post(
            "/admin/social-platforms",
            { name: "Stripe", category: "payment" },
            headers
          );
          await api.post(
            "/admin/social-platforms",
            { name: "SendGrid", category: "email" },
            headers
          );
        });

        it("should filter platforms by category", async () => {
          const response = await api.get(
            "/admin/social-platforms?category=social",
            headers
          );

          expect(response.status).toBe(200);
          expect(response.data.socialPlatforms).toBeInstanceOf(Array);
          
          const socialPlatforms = response.data.socialPlatforms.filter(
            (p: any) => p.category === "social"
          );
          expect(socialPlatforms.length).toBeGreaterThan(0);
          socialPlatforms.forEach((platform: any) => {
            expect(platform.category).toBe("social");
          });
        });

        it("should filter platforms by status", async () => {
          // Update one platform to inactive
          const listResponse = await api.get("/admin/social-platforms", adminHeaders);
          const firstPlatform = listResponse.data.socialPlatforms[0];

          await api.post(
            `/admin/social-platforms/${firstPlatform.id}`,
            { status: "inactive" },
            headers
          );

          const activeResponse = await api.get(
            "/admin/social-platforms?status=active",
            headers
          );

          expect(activeResponse.status).toBe(200);
          const activePlatforms = activeResponse.data.socialPlatforms.filter(
            (p: any) => p.status === "active"
          );
          activePlatforms.forEach((platform: any) => {
            expect(platform.status).toBe("active");
          });
        });
      });

      describe("Different API Categories", () => {
        const testCases = [
          { name: "Instagram", category: "social", auth_type: "oauth2" },
          { name: "PayPal", category: "payment", auth_type: "oauth2" },
          { name: "FedEx", category: "shipping", auth_type: "api_key" },
          { name: "Mailgun", category: "email", auth_type: "api_key" },
          { name: "Twilio", category: "sms", auth_type: "basic" },
          { name: "Google Analytics", category: "analytics", auth_type: "oauth2" },
          { name: "Salesforce", category: "crm", auth_type: "oauth2" },
          { name: "AWS S3", category: "storage", auth_type: "api_key" },
        ];

        testCases.forEach(({ name, category, auth_type }) => {
          it(`should create ${category} platform: ${name}`, async () => {
            const createResponse = await api.post(
              "/admin/social-platforms",
              { name, category, auth_type },
              headers
            );

            expect(createResponse.status).toBe(201);
            const platform = createResponse.data.socialPlatform;

            expect(platform.name).toBe(name);
            expect(platform.category).toBe(category);
            expect(platform.auth_type).toBe(auth_type);

            // Cleanup
            await api.delete(`/admin/social-platforms/${platform.id}`, adminHeaders);
          });
        });
      });

      describe("Default Values", () => {
        it("should apply default values for category and auth_type", async () => {
          const createResponse = await api.post(
            "/admin/social-platforms",
            { name: "Test Platform" },
            headers
          );

          expect(createResponse.status).toBe(201);
          const platform = createResponse.data.socialPlatform;

          expect(platform.category).toBe("social"); // Default
          expect(platform.auth_type).toBe("oauth2"); // Default
          expect(platform.status).toBe("active"); // Default

          // Cleanup
          await api.delete(`/admin/social-platforms/${platform.id}`, adminHeaders);
        });
      });

      describe("Validation", () => {
        it("should reject invalid category", async () => {
          const createResponse = await api
            .post(
              "/admin/social-platforms",
              { name: "Test", category: "invalid_category" },
              headers
            )
            .catch((err) => err.response);

          expect(createResponse.status).toBe(400);
        });

        it("should reject invalid auth_type", async () => {
          const createResponse = await api
            .post(
              "/admin/social-platforms",
              { name: "Test", auth_type: "invalid_auth" },
              headers
            )
            .catch((err) => err.response);

          expect(createResponse.status).toBe(400);
        });

        it("should reject invalid status", async () => {
          const createResponse = await api
            .post(
              "/admin/social-platforms",
              { name: "Test", status: "invalid_status" },
              headers
            )
            .catch((err) => err.response);

          expect(createResponse.status).toBe(400);
        });
      });
    });
  }
);