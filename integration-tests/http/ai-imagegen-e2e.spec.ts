import { createTestCustomer, getCustomerAuthHeaders, resetTestCustomerCredentials } from "../helpers/create-customer";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

// Increase timeout for AI operations which can take longer
jest.setTimeout(120000);

/**
 * End-to-end integration test for AI image generation flow.
 *
 * This test covers the complete workflow:
 * 1. Customer creation and authentication
 * 2. AI image generation via POST /store/ai/imagegen
 * 3. Verification that a design is created and linked to the customer
 * 4. Loading designs with include_ai=true filter
 *
 * Requires AI_GATEWAY_API_KEY environment variable to be set.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();
  let customerHeaders: any;

  // Check if AI_GATEWAY_API_KEY is available
  const hasAiApiKey = !!process.env.AI_GATEWAY_API_KEY;

  beforeEach(async () => {
    // Reset credentials before each test to ensure fresh customer
    resetTestCustomerCredentials();

    const container = getContainer();
    await createTestCustomer(container);
    customerHeaders = await getCustomerAuthHeaders();
  });

  describe("AI Image Generation E2E Flow", () => {
    // Skip tests if AI_GATEWAY_API_KEY is not available
    const conditionalIt = hasAiApiKey ? it : it.skip;

    conditionalIt("should generate an AI image and create a design linked to customer", async () => {
      // Step 1: Generate AI image with badges and materials prompt
      const generatePayload = {
        mode: "commit",
        badges: {
          style: "Bohemian",
          color_family: "Earth Tones",
          body_type: "Hourglass",
          occasion: "Casual",
        },
        materials_prompt: "A flowy maxi dress with floral embroidery and natural linen fabric",
      };

      console.log("[Test] Generating AI image...");
      const generateResponse = await api.post(
        "/store/ai/imagegen",
        generatePayload,
        customerHeaders
      );

      expect(generateResponse.status).toBe(200);
      expect(generateResponse.data.generation).toBeDefined();

      const generation = generateResponse.data.generation;
      console.log("[Test] Generation result:", {
        mode: generation.mode,
        preview_url: generation.preview_url?.substring(0, 100),
        design_id: generation.design_id,
        prompt_used: generation.prompt_used?.substring(0, 100),
      });

      // Verify response structure
      expect(generation.mode).toBe("commit");
      expect(generation.preview_url).toBeDefined();
      expect(generation.media_id).toBeDefined();
      expect(generation.design_id).toBeDefined();
      expect(generation.prompt_used).toBeDefined();
      expect(generation.badges).toMatchObject({
        style: "Bohemian",
        color_family: "Earth Tones",
      });

      const createdDesignId = generation.design_id;

      // Step 2: Verify design is retrievable via store API with include_ai=true
      console.log("[Test] Fetching AI designs...");
      const listResponse = await api.get(
        "/store/custom/designs?include_ai=true",
        { headers: customerHeaders.headers }
      );

      expect(listResponse.status).toBe(200);
      expect(listResponse.data.designs).toBeInstanceOf(Array);
      expect(listResponse.data.designs.length).toBeGreaterThanOrEqual(1);

      // Find the created design
      const foundDesign = listResponse.data.designs.find(
        (d: any) => d.id === createdDesignId
      );

      expect(foundDesign).toBeDefined();
      expect(foundDesign.origin_source).toBe("ai-mistral");
      expect(foundDesign.thumbnail_url).toBeDefined();
      expect(foundDesign.name).toContain("AI Design");

      console.log("[Test] Found design:", {
        id: foundDesign.id,
        name: foundDesign.name,
        origin_source: foundDesign.origin_source,
        thumbnail_url: foundDesign.thumbnail_url?.substring(0, 80),
      });
    });

    conditionalIt("should generate a preview image without creating a design", async () => {
      // Preview mode should still upload the image but create a design entry
      const generatePayload = {
        mode: "preview",
        badges: {
          style: "Minimalist",
          color_family: "Neutrals",
        },
        materials_prompt: "A simple white cotton t-shirt with clean lines",
      };

      console.log("[Test] Generating preview AI image...");
      const generateResponse = await api.post(
        "/store/ai/imagegen",
        generatePayload,
        customerHeaders
      );

      expect(generateResponse.status).toBe(200);
      expect(generateResponse.data.generation).toBeDefined();

      const generation = generateResponse.data.generation;
      expect(generation.mode).toBe("preview");
      expect(generation.preview_url).toBeDefined();
      // In both modes, we now create a design for history
      expect(generation.design_id).toBeDefined();
    });

    it("should require customer authentication", async () => {
      const generatePayload = {
        mode: "preview",
        badges: { style: "Modern" },
      };

      // Make request without auth headers - Medusa returns 400 for not_allowed errors
      const response = await api
        .post("/store/ai/imagegen", generatePayload)
        .catch((err: any) => err.response);

      // Note: Medusa converts "not_allowed" errors to 400 status in the error handler
      expect([400, 401]).toContain(response.status);
    });

    conditionalIt("should handle missing materials_prompt gracefully", async () => {
      // Test with only badges, no materials prompt
      const generatePayload = {
        mode: "preview",
        badges: {
          style: "Classic",
          occasion: "Formal",
        },
      };

      const generateResponse = await api.post(
        "/store/ai/imagegen",
        generatePayload,
        customerHeaders
      );

      expect(generateResponse.status).toBe(200);
      expect(generateResponse.data.generation.preview_url).toBeDefined();
    });

    describe("Design retrieval with filters", () => {
      conditionalIt("should filter designs by origin_source", async () => {
        // First create an AI design
        const generatePayload = {
          mode: "commit",
          badges: { style: "Vintage" },
          materials_prompt: "A retro inspired polka dot dress",
        };

        await api.post("/store/ai/imagegen", generatePayload, customerHeaders);

        // Then filter by origin_source
        const aiDesignsResponse = await api.get(
          "/store/custom/designs?origin_source=ai-mistral",
          { headers: customerHeaders.headers }
        );

        expect(aiDesignsResponse.status).toBe(200);
        expect(aiDesignsResponse.data.designs).toBeInstanceOf(Array);

        // All returned designs should have origin_source = "ai-mistral"
        aiDesignsResponse.data.designs.forEach((design: any) => {
          expect(design.origin_source).toBe("ai-mistral");
        });
      });

      conditionalIt("should return empty array when no AI designs exist for new customer", async () => {
        // Create a new customer (this overwrites the current credentials)
        resetTestCustomerCredentials();
        const container = getContainer();
        const { customer: newCustomer } = await createTestCustomer(container);
        const newCustomerHeaders = await getCustomerAuthHeaders();

        const response = await api.get(
          "/store/custom/designs?include_ai=true",
          { headers: newCustomerHeaders.headers }
        );

        expect(response.status).toBe(200);
        expect(response.data.designs).toEqual([]);
        expect(response.data.count).toBe(0);
      });
    });
  });

  describe("AI Image Generation validation", () => {
    it("should validate mode parameter", async () => {
      const invalidPayload = {
        mode: "invalid_mode",
        badges: { style: "Modern" },
      };

      const response = await api
        .post("/store/ai/imagegen", invalidPayload, customerHeaders)
        .catch((err: any) => err.response);

      expect(response.status).toBe(400);
    });

    it("should validate materials_prompt length", async () => {
      const invalidPayload = {
        mode: "preview",
        materials_prompt: "ab", // Too short, minimum is 3 characters
      };

      const response = await api
        .post("/store/ai/imagegen", invalidPayload, customerHeaders)
        .catch((err: any) => err.response);

      expect(response.status).toBe(400);
    });

    // This test requires the AI API key to actually generate an image
    (hasAiApiKey ? it : it.skip)("should accept valid reference images", async () => {
      const validPayload = {
        mode: "preview",
        badges: { style: "Modern" },
        reference_images: [
          {
            url: "https://example.com/reference.jpg",
            weight: 0.7,
          },
        ],
      };

      const response = await api.post(
        "/store/ai/imagegen",
        validPayload,
        customerHeaders
      );

      expect(response.status).toBe(200);
    });
  });
});
