import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);

const bugFixTemplate = {
  name: "Bug Fix Template",
  description: "Standard template for bug fixes",
  priority: "high",
  estimated_duration: 120, // in minutes
  required_fields: {
    "bug_id": { type: "string", required: true },
    "severity": { type: "enum", options: ["low", "medium", "high"], required: true },
    "steps_to_reproduce": { type: "text", required: true }
  },
  eventable: true,
  notifiable: true,
  message_template: "Bug {{bug_id}} has been assigned to you. Severity: {{severity}}",
  metadata: {
    type: "technical",
    team: "engineering"
  },
  category: {
    name: "Bug Fixes",
    description: "Tasks related to fixing bugs in the application",
    metadata: {
      priority: "high"
    }
  }
};

const featureTemplate = {
  name: "Feature Development Template",
  description: "Template for new feature development",
  priority: "medium",
  estimated_duration: 480, // in minutes
  required_fields: {
    "feature_id": { type: "string", required: true },
    "requirements_doc": { type: "url", required: true },
    "design_doc": { type: "url", required: false }
  },
  eventable: true,
  notifiable: true,
  message_template: "New feature task {{feature_id}} has been assigned.",
  metadata: {
    type: "feature",
    team: "product"
  },
  category: {
    name: "Feature Templates",
    description: "Tasks related to feature development",
    metadata: {
      priority: "medium"
    }
  }
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let bugFixTemplateId;
    let featureTemplateId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create bug fix template
      const bugFixResponse = await api.post("/admin/task-templates", bugFixTemplate, headers);
      bugFixTemplateId = bugFixResponse.data.task_template.id;

      // Create feature template
      const featureResponse = await api.post("/admin/task-templates", featureTemplate, headers);
      featureTemplateId = featureResponse.data.task_template.id;
    });

    describe("POST /admin/task-templates", () => {
      it("should create a new task template", async () => {
        const newTemplate = {
          name: "Code Review Template",
          description: "Template for code review tasks",
          priority: "medium",
          estimated_duration: 60,
          required_fields: {
            "pr_link": { type: "url", required: true }
          }
        };

        const response = await api.post("/admin/task-templates", newTemplate, headers);

        expect(response.status).toBe(201);
        expect(response.data.task_template).toMatchObject({
          ...newTemplate,
          id: expect.any(String)
        });
      });

      it("should fail to create a template without required fields", async () => {
        const invalidTemplate = {
          description: "Missing required name field"
        };

        const response = await api
          .post("/admin/task-templates", invalidTemplate, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(400);
      });
    });

    describe("GET /admin/task-templates", () => {
      it("should list all templates with pagination", async () => {
        const response = await api.get("/admin/task-templates", {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.task_templates).toBeInstanceOf(Array);
        expect(response.data.task_templates.length).toBeGreaterThanOrEqual(2);
        expect(response.data).toHaveProperty("count");
        expect(response.data).toHaveProperty("offset");
        expect(response.data).toHaveProperty("limit");
      });

      it("should filter templates by priority", async () => {
        const response = await api.get("/admin/task-templates?priority=high", {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.task_templates).toBeInstanceOf(Array);
        expect(response.data.task_templates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: bugFixTemplateId,
              priority: "high"
            })
          ])
        );
      });

      it("should filter templates by name", async () => {
        const response = await api.get("/admin/task-templates?name=Bug Fix Template", {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.task_templates).toBeInstanceOf(Array);
        expect(response.data.task_templates).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: bugFixTemplateId,
              name: "Bug Fix Template"
            })
          ])
        );
      });
    });

    describe("GET /admin/task-templates/:id", () => {
      it("should retrieve bug fix template", async () => {
        const response = await api.get(`/admin/task-templates/${bugFixTemplateId}`, {
          headers: headers.headers,
        });
        expect(response.status).toBe(200);
        expect(response.data.task_template.id).toBe(bugFixTemplateId);
        expect(response.data.task_template).toMatchObject({
          ...bugFixTemplate,
          id: bugFixTemplateId,
        });
      });

      it("should retrieve feature template", async () => {
        const response = await api.get(`/admin/task-templates/${featureTemplateId}`, {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.task_template.id).toBe(featureTemplateId);
        expect(response.data.task_template).toMatchObject({
          ...featureTemplate,
          id: featureTemplateId,
        });
      });

      it("should return 404 for non-existent template", async () => {
        const response = await api
          .get("/admin/task-templates/non-existent-id", {
            headers: headers.headers,
          })
          .catch((err) => err.response);
        expect(response.status).toBe(404);
      });
    });

    describe("PUT /admin/task-templates/:id", () => {
      it("should update bug fix template", async () => {
        const updateData = {
          name: "Updated Bug Fix Template",
          priority: "medium",
          estimated_duration: 90,
          required_fields: {
            ...bugFixTemplate.required_fields,
            "environment": { type: "string", required: true }
          }
        };

        const response = await api.put(
          `/admin/task-templates/${bugFixTemplateId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.task_template).toMatchObject({
          ...bugFixTemplate,
          ...updateData,
          id: bugFixTemplateId
        });
      });

      it("should partially update feature template", async () => {
        const updateData = {
          priority: "high",
          notifiable: false
        };

        const response = await api.put(
          `/admin/task-templates/${featureTemplateId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.task_template).toMatchObject({
          ...featureTemplate,
          ...updateData,
          id: featureTemplateId
        });
      });

      it("should return 404 when updating non-existent template", async () => {
        const response = await api
          .put(
            "/admin/task-templates/non-existent-id",
            { name: "Updated Name" },
            headers
          )
          .catch((err) => err.response);
        expect(response.status).toBe(404);
      });
    });

    describe("DELETE /admin/task-templates/:id", () => {
      it("should delete a template", async () => {
        const response = await api.delete(
          `/admin/task-templates/${bugFixTemplateId}`,
          headers
        );

        expect(response.status).toBe(204);

        // Verify template is deleted
        const getResponse = await api
          .get(`/admin/task-templates/${bugFixTemplateId}`, {
            headers: headers.headers,
          })
          .catch((err) => err.response);
        expect(getResponse.status).toBe(404);
      });

      it("should return 404 when deleting non-existent template", async () => {
        const response = await api
          .delete("/admin/task-templates/non-existent-id", headers)
          .catch((err) => err.response);
        expect(response.status).toBe(404);
      });
    });
  },
});
