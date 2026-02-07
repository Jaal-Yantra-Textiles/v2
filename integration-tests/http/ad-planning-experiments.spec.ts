/**
 * Ad Planning - A/B Experiments API Integration Tests
 *
 * Tests A/B experiment creation, lifecycle management, and statistical results.
 * Note: Each test runs in isolation - data must be created within each test.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
  let headers: any;
  let websiteId: string;

  const { api, getContainer } = getSharedTestEnv();

  // Helper to create an experiment
  async function createExperiment(name: string = "Test Experiment") {
    const response = await api.post(
      "/admin/ad-planning/experiments",
      {
        name,
        description: "Test experiment",
        website_id: websiteId,
        primary_metric: "conversion_rate",
        control_name: "Control",
        treatment_name: "Treatment",
        control_config: { variant: "A" },
        treatment_config: { variant: "B" },
        traffic_split: 50,
        target_sample_size: 1000,
        confidence_level: 0.95,
      },
      headers
    );
    return response.data.experiment;
  }

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a test website
    const websiteResponse = await api.post(
      "/admin/websites",
      {
        domain: "experiments-test.example.com",
        name: "Experiments Test Website",
        status: "Development",
      },
      headers
    );
    websiteId = websiteResponse.data.website.id;
  });

  describe("A/B Experiments CRUD", () => {
    describe("POST /admin/ad-planning/experiments", () => {
      it("should create an A/B experiment", async () => {
        const experimentData = {
          name: "Homepage CTA Test",
          description: "Testing different CTA button colors",
          website_id: websiteId,
          hypothesis: "A green CTA will increase conversions by 10%",
          primary_metric: "conversion_rate",
          control_name: "Blue Button",
          treatment_name: "Green Button",
          control_config: { button_color: "blue" },
          treatment_config: { button_color: "green" },
          traffic_split: 50,
          target_sample_size: 1000,
          confidence_level: 0.95,
          auto_stop: true,
        };

        const response = await api.post(
          "/admin/ad-planning/experiments",
          experimentData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.experiment).toBeDefined();
        expect(response.data.experiment.name).toBe(experimentData.name);
        expect(response.data.experiment.status).toBe("draft");
        expect(response.data.experiment.primary_metric).toBe("conversion_rate");
        expect(response.data.experiment.variants).toBeDefined();
      });

      it("should create an experiment with default values", async () => {
        const experimentData = {
          name: "Pricing Page Test",
          primary_metric: "roas",
        };

        const response = await api.post(
          "/admin/ad-planning/experiments",
          experimentData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.experiment.variants).toBeDefined();
        expect(Array.isArray(response.data.experiment.variants)).toBe(true);
      });

      it("should fail with invalid primary metric", async () => {
        const response = await api
          .post(
            "/admin/ad-planning/experiments",
            {
              name: "Invalid Test",
              primary_metric: "invalid_metric",
            },
            headers
          )
          .catch((e) => e.response);

        expect(response.status).toBe(400);
      });
    });

    describe("GET /admin/ad-planning/experiments", () => {
      it("should list all experiments", async () => {
        // Create an experiment first
        await createExperiment("List Test");

        const response = await api.get(
          "/admin/ad-planning/experiments",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiments).toBeDefined();
        expect(response.data.experiments.length).toBeGreaterThanOrEqual(1);
      });

      it("should filter experiments by status", async () => {
        await createExperiment("Status Filter Test");

        const response = await api.get(
          "/admin/ad-planning/experiments?status=draft",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.experiments.every((e: any) => e.status === "draft")
        ).toBe(true);
      });

      it("should filter experiments by website", async () => {
        await createExperiment("Website Filter Test");

        const response = await api.get(
          `/admin/ad-planning/experiments?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.experiments.length > 0) {
          expect(
            response.data.experiments.every(
              (e: any) => e.website_id === websiteId
            )
          ).toBe(true);
        }
      });

      it("should support pagination", async () => {
        const response = await api.get(
          "/admin/ad-planning/experiments?limit=5&offset=0",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiments.length).toBeLessThanOrEqual(5);
        expect(response.data.limit).toBe(5);
        expect(response.data.offset).toBe(0);
      });
    });

    describe("GET /admin/ad-planning/experiments/:id", () => {
      it("should get a specific experiment", async () => {
        const experiment = await createExperiment("Get Test");

        const response = await api.get(
          `/admin/ad-planning/experiments/${experiment.id}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiment).toBeDefined();
        expect(response.data.experiment.id).toBe(experiment.id);
      });

      it("should return 404 for non-existent experiment", async () => {
        const response = await api
          .get("/admin/ad-planning/experiments/non-existent-id", headers)
          .catch((e) => e.response);

        expect(response.status).toBe(404);
      });
    });

    describe("PUT /admin/ad-planning/experiments/:id", () => {
      it("should update an experiment", async () => {
        const experiment = await createExperiment("Update Test");

        const updateData = {
          name: "Updated Experiment Name",
          description: "Updated description",
          target_sample_size: 2000,
        };

        const response = await api.put(
          `/admin/ad-planning/experiments/${experiment.id}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiment.name).toBe(updateData.name);
        expect(response.data.experiment.target_sample_size).toBe(2000);
      });

      it("should update description", async () => {
        const experiment = await createExperiment("Description Test");

        const response = await api.put(
          `/admin/ad-planning/experiments/${experiment.id}`,
          { description: "New description" },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiment.description).toBe("New description");
      });
    });
  });

  describe("Experiment Lifecycle", () => {
    describe("POST /admin/ad-planning/experiments/:id/start", () => {
      it("should start an experiment", async () => {
        const experiment = await createExperiment("Start Test");

        const response = await api.post(
          `/admin/ad-planning/experiments/${experiment.id}/start`,
          {},
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiment.status).toBe("running");
        expect(response.data.experiment.started_at).toBeDefined();
        expect(response.data.message).toContain("started");
      });

      it("should fail to start an already running experiment", async () => {
        const experiment = await createExperiment("Already Running Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

        const response = await api
          .post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers)
          .catch((e) => e.response);

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("already running");
      });

      it("should fail to modify a running experiment", async () => {
        const experiment = await createExperiment("Modify Running Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

        const response = await api
          .put(`/admin/ad-planning/experiments/${experiment.id}`, { name: "Should Fail" }, headers)
          .catch((e) => e.response);

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("running");
      });
    });

    describe("GET /admin/ad-planning/experiments/:id/results", () => {
      it("should get experiment results", async () => {
        const experiment = await createExperiment("Results Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

        const response = await api.get(
          `/admin/ad-planning/experiments/${experiment.id}/results`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiment).toBeDefined();
        expect(response.data.statistics).toBeDefined();
        expect(response.data.statistics.control).toBeDefined();
        expect(response.data.statistics.treatment).toBeDefined();
        expect(response.data.statistics.pValue).toBeDefined();
        expect(response.data.statistics.significance).toBeDefined();
        expect(response.data.progress).toBeDefined();
        expect(response.data.runtime).toBeDefined();
      });

      it("should include lift calculation", async () => {
        const experiment = await createExperiment("Lift Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

        const response = await api.get(
          `/admin/ad-planning/experiments/${experiment.id}/results`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.statistics.lift).toBeDefined();
        expect(response.data.statistics.lift.liftPercent).toBeDefined();
        expect(response.data.statistics.lift.direction).toBeDefined();
      });

      it("should include recommendation", async () => {
        const experiment = await createExperiment("Recommendation Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

        const response = await api.get(
          `/admin/ad-planning/experiments/${experiment.id}/results`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.recommendation).toBeDefined();
      });
    });

    describe("POST /admin/ad-planning/experiments/:id/stop", () => {
      it("should stop an experiment", async () => {
        const experiment = await createExperiment("Stop Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

        const response = await api.post(
          `/admin/ad-planning/experiments/${experiment.id}/stop`,
          { reason: "Test completed" },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.experiment.status).toBe("completed");
        expect(response.data.experiment.ended_at).toBeDefined();
        expect(response.data.results).toBeDefined();
        expect(response.data.message).toContain("completed");
      });

      it("should fail to stop an already completed experiment", async () => {
        const experiment = await createExperiment("Already Completed Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/stop`, {}, headers);

        const response = await api
          .post(`/admin/ad-planning/experiments/${experiment.id}/stop`, {}, headers)
          .catch((e) => e.response);

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("already completed");
      });

      it("should fail to restart a completed experiment", async () => {
        const experiment = await createExperiment("Restart Completed Test");
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);
        await api.post(`/admin/ad-planning/experiments/${experiment.id}/stop`, {}, headers);

        const response = await api
          .post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers)
          .catch((e) => e.response);

        expect(response.status).toBe(400);
        expect(response.data.message).toContain("Cannot restart");
      });
    });
  });

  describe("DELETE /admin/ad-planning/experiments/:id", () => {
    it("should delete an experiment", async () => {
      const experiment = await createExperiment("Delete Test");

      const response = await api.delete(
        `/admin/ad-planning/experiments/${experiment.id}`,
        headers
      );

      expect(response.status).toBe(200);
      expect(response.data.deleted).toBe(true);

      // Verify deletion
      const verifyResponse = await api
        .get(`/admin/ad-planning/experiments/${experiment.id}`, headers)
        .catch((e) => e.response);

      expect(verifyResponse.status).toBe(404);
    });

    it("should fail to delete a running experiment", async () => {
      const experiment = await createExperiment("Running Delete Test");
      await api.post(`/admin/ad-planning/experiments/${experiment.id}/start`, {}, headers);

      const response = await api
        .delete(`/admin/ad-planning/experiments/${experiment.id}`, headers)
        .catch((e) => e.response);

      expect(response.status).toBe(400);
      expect(response.data.message).toContain("running");
    });
  });
});
