import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  resetTestCustomerCredentials,
} from "../helpers/create-customer";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60000);

const sampleDesign = {
  name: "Admin-Created Design",
  description: "A sample design created by admin for customer",
  design_type: "Original",
  status: "Conceptual",
  priority: "High",
  tags: ["admin-brief", "sample"],
  metadata: {
    base_product_handle: "kurta-cotton",
  },
};

const sampleMoodboard = {
  type: "excalidraw",
  version: 2,
  source: "jyt-design-editor",
  elements: [
    {
      id: "layer-test-layer-1-1234567890",
      type: "rectangle",
      x: 60,
      y: 130,
      width: 100,
      height: 80,
      angle: 0,
      strokeColor: "#000000",
      backgroundColor: "#ff0000",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      opacity: 100,
      seed: 123456,
      version: 1,
      versionNonce: 654321,
      isDeleted: false,
      boundElements: null,
      updated: 1234567890,
      link: null,
      locked: false,
    },
    {
      id: "title-1234567890",
      type: "text",
      x: 20,
      y: 20,
      width: 400,
      height: 40,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      roughness: 0,
      opacity: 100,
      seed: 111111,
      version: 1,
      versionNonce: 222222,
      isDeleted: false,
      boundElements: null,
      updated: 1234567890,
      link: null,
      locked: false,
      text: "Design: Admin-Created Design",
      fontSize: 28,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
    },
  ],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null,
  },
  files: {},
};

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();
  let adminHeaders: any;
  let customerHeaders: any;
  let customerId: string;
  let designId: string;

  beforeEach(async () => {
    const container = getContainer();

    // Set up admin
    await createAdminUser(container);
    adminHeaders = await getAuthHeaders(api);

    // Set up customer (resets state each time)
    resetTestCustomerCredentials();
    const { customer } = await createTestCustomer(container);
    customerId = customer.id;
    customerHeaders = await getCustomerAuthHeaders();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin: Create design linked to customer
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Admin: POST /admin/designs (with customer_id_for_link)", () => {
    it("should create a design and link it to a customer", async () => {
      const response = await api.post(
        "/admin/designs",
        {
          ...sampleDesign,
          customer_id_for_link: customerId,
        },
        adminHeaders
      );

      expect(response.status).toBe(201);
      expect(response.data.design).toMatchObject({
        name: sampleDesign.name,
        status: sampleDesign.status,
        design_type: sampleDesign.design_type,
      });
      designId = response.data.design.id;
    });

    it("should store base_product_handle in metadata", async () => {
      const response = await api.post(
        "/admin/designs",
        {
          ...sampleDesign,
          customer_id_for_link: customerId,
        },
        adminHeaders
      );

      expect(response.status).toBe(201);
      expect(response.data.design.metadata?.base_product_handle).toBe(
        "kurta-cotton"
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Admin: List designs filtered by customer_id
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Admin: GET /admin/designs?customer_id=xxx", () => {
    beforeEach(async () => {
      // Create a design linked to this customer
      const resp = await api.post(
        "/admin/designs",
        { ...sampleDesign, customer_id_for_link: customerId },
        adminHeaders
      );
      designId = resp.data.design.id;

      // Create another design NOT linked to this customer
      await api.post(
        "/admin/designs",
        { ...sampleDesign, name: "Unlinked Design" },
        adminHeaders
      );
    });

    it("should return only designs linked to the specified customer", async () => {
      const response = await api.get(
        `/admin/designs?customer_id=${customerId}`,
        { headers: adminHeaders.headers }
      );

      expect(response.status).toBe(200);
      expect(response.data.designs).toBeInstanceOf(Array);
      // Should include our linked design
      expect(response.data.designs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: designId }),
        ])
      );
      // All returned designs should be the linked one (not the unlinked one)
      const names = response.data.designs.map((d: any) => d.name);
      expect(names).not.toContain("Unlinked Design");
    });

    it("should return empty array for a customer with no designs", async () => {
      // Create a second customer with no designs
      resetTestCustomerCredentials();
      const { customer: customer2 } = await createTestCustomer(getContainer());

      const response = await api.get(
        `/admin/designs?customer_id=${customer2.id}`,
        { headers: adminHeaders.headers }
      );

      expect(response.status).toBe(200);
      expect(response.data.designs).toBeInstanceOf(Array);
      expect(response.data.designs).toHaveLength(0);
    });

    it("should return pagination metadata", async () => {
      const response = await api.get(
        `/admin/designs?customer_id=${customerId}`,
        { headers: adminHeaders.headers }
      );

      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty("count");
      expect(response.data).toHaveProperty("offset");
      expect(response.data).toHaveProperty("limit");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Store: GET /store/custom/designs/:id
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Store: GET /store/custom/designs/:id", () => {
    beforeEach(async () => {
      // Admin creates a design linked to this customer with a moodboard
      const resp = await api.post(
        "/admin/designs",
        {
          ...sampleDesign,
          customer_id_for_link: customerId,
          moodboard: sampleMoodboard,
        },
        adminHeaders
      );
      designId = resp.data.design.id;
    });

    it("should return the design for the owning customer", async () => {
      const response = await api.get(
        `/store/custom/designs/${designId}`,
        customerHeaders
      );

      expect(response.status).toBe(200);
      expect(response.data.design).toMatchObject({
        id: designId,
        name: sampleDesign.name,
        status: sampleDesign.status,
      });
    });

    it("should return moodboard in the design response", async () => {
      const response = await api.get(
        `/store/custom/designs/${designId}`,
        customerHeaders
      );

      expect(response.status).toBe(200);
      expect(response.data.design.moodboard).toBeDefined();
      expect(response.data.design.moodboard.type).toBe("excalidraw");
      expect(Array.isArray(response.data.design.moodboard.elements)).toBe(true);
    });

    it("should return metadata including base_product_handle", async () => {
      const response = await api.get(
        `/store/custom/designs/${designId}`,
        customerHeaders
      );

      expect(response.status).toBe(200);
      expect(response.data.design.metadata?.base_product_handle).toBe(
        "kurta-cotton"
      );
    });

    it("should return 404 for a design not owned by this customer", async () => {
      // Create another design NOT linked to this customer
      const otherResp = await api.post(
        "/admin/designs",
        { ...sampleDesign, name: "Other Customer Design" },
        adminHeaders
      );
      const otherDesignId = otherResp.data.design.id;

      const response = await api
        .get(`/store/custom/designs/${otherDesignId}`, customerHeaders)
        .catch((err) => err.response);

      expect(response.status).toBe(404);
    });

    it("should return 401 when no auth is provided", async () => {
      const response = await api
        .get(`/store/custom/designs/${designId}`)
        .catch((err) => err.response);

      expect(response.status).toBe(401);
    });

    it("should return 404 for a non-existent design ID", async () => {
      const response = await api
        .get("/store/custom/designs/non-existent-id", customerHeaders)
        .catch((err) => err.response);

      expect(response.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Store: PUT /store/custom/designs/:id (customer updates with new layers)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Store: PUT /store/custom/designs/:id (customer edits)", () => {
    beforeEach(async () => {
      const resp = await api.post(
        "/admin/designs",
        {
          ...sampleDesign,
          customer_id_for_link: customerId,
          moodboard: sampleMoodboard,
        },
        adminHeaders
      );
      designId = resp.data.design.id;
    });

    it("should allow customer to update the design with new layers and moodboard", async () => {
      const updatedLayers = [
        {
          id: "layer-1",
          type: "rect",
          x: 50,
          y: 50,
          width: 120,
          height: 80,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          fill: "#0000ff",
          strokeColor: "#000000",
          strokeWidth: 1,
          opacity: 1,
          draggable: true,
        },
      ];

      const updatedMoodboard = {
        ...sampleMoodboard,
        elements: [
          ...sampleMoodboard.elements,
          {
            id: "layer-test-layer-1-updated",
            type: "rectangle",
            x: 60,
            y: 130,
            width: 120,
            height: 80,
            angle: 0,
            strokeColor: "#000000",
            backgroundColor: "#0000ff",
            fillStyle: "solid",
            strokeWidth: 1,
            roughness: 0,
            opacity: 100,
            seed: 999999,
            version: 2,
            versionNonce: 888888,
            isDeleted: false,
            boundElements: null,
            updated: Date.now(),
            link: null,
            locked: false,
          },
        ],
      };

      const response = await api.put(
        `/store/custom/designs/${designId}`,
        {
          metadata: { ...sampleDesign.metadata, layers: updatedLayers },
          moodboard: updatedMoodboard,
        },
        customerHeaders
      );

      expect(response.status).toBe(200);
      expect(response.data.design.id).toBe(designId);
      expect(response.data.design.metadata?.layers).toHaveLength(1);
      expect(response.data.design.metadata?.layers[0].fill).toBe("#0000ff");
    });

    it("should not allow customer to update a design they do not own", async () => {
      // Create a design NOT linked to this customer
      const otherResp = await api.post(
        "/admin/designs",
        { ...sampleDesign, name: "Unowned Design" },
        adminHeaders
      );
      const otherDesignId = otherResp.data.design.id;

      const response = await api
        .put(
          `/store/custom/designs/${otherDesignId}`,
          { name: "Hacked Name" },
          customerHeaders
        )
        .catch((err) => err.response);

      expect(response.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Full round-trip: Admin creates → customer fetches → customer edits → admin sees update
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Full round-trip: admin creates, customer edits, admin sees updated moodboard", () => {
    it("should complete the full customer design studio flow", async () => {
      // Step 1: Admin creates a design with moodboard, linked to customer
      const createResp = await api.post(
        "/admin/designs",
        {
          ...sampleDesign,
          customer_id_for_link: customerId,
          moodboard: sampleMoodboard,
        },
        adminHeaders
      );
      expect(createResp.status).toBe(201);
      const createdDesignId = createResp.data.design.id;

      // Step 2: Admin can list the design by customer_id
      const adminListResp = await api.get(
        `/admin/designs?customer_id=${customerId}`,
        { headers: adminHeaders.headers }
      );
      expect(adminListResp.status).toBe(200);
      expect(adminListResp.data.designs.map((d: any) => d.id)).toContain(
        createdDesignId
      );

      // Step 3: Customer fetches the design from the store endpoint
      const customerGetResp = await api.get(
        `/store/custom/designs/${createdDesignId}`,
        customerHeaders
      );
      expect(customerGetResp.status).toBe(200);
      const fetchedDesign = customerGetResp.data.design;
      expect(fetchedDesign.moodboard).toBeDefined();
      expect(fetchedDesign.metadata?.base_product_handle).toBe("kurta-cotton");

      // The moodboard should contain the real layer element (not the utility chrome)
      const layerElements = fetchedDesign.moodboard.elements.filter(
        (el: any) => el.id.startsWith("layer-")
      );
      expect(layerElements).toHaveLength(1);
      expect(layerElements[0].backgroundColor).toBe("#ff0000");

      // Step 4: Customer edits and saves layers + new moodboard
      const customerLayers = [
        {
          id: "layer-test-layer-1-1234567890",
          type: "rect",
          x: 60,
          y: 130,
          width: 100,
          height: 80,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          fill: "#00ff00", // customer changed the color
          strokeColor: "#000000",
          strokeWidth: 1,
          opacity: 1,
          draggable: true,
        },
      ];

      const customerUpdatedMoodboard = {
        type: "excalidraw",
        version: 2,
        source: "jyt-design-editor",
        elements: [
          {
            id: "layer-test-layer-1-1234567890",
            type: "rectangle",
            x: 60,
            y: 130,
            width: 100,
            height: 80,
            angle: 0,
            strokeColor: "#000000",
            backgroundColor: "#00ff00",
            fillStyle: "solid",
            strokeWidth: 1,
            roughness: 0,
            opacity: 100,
            seed: 123456,
            version: 2,
            versionNonce: 654321,
            isDeleted: false,
            boundElements: null,
            updated: Date.now(),
            link: null,
            locked: false,
          },
        ],
        appState: { viewBackgroundColor: "#ffffff", gridSize: null },
        files: {},
      };

      const putResp = await api.put(
        `/store/custom/designs/${createdDesignId}`,
        {
          metadata: {
            base_product_handle: "kurta-cotton",
            layers: customerLayers,
          },
          moodboard: customerUpdatedMoodboard,
        },
        customerHeaders
      );
      expect(putResp.status).toBe(200);

      // Step 5: Admin can now see the customer's updated moodboard via admin GET
      const adminGetResp = await api.get(
        `/admin/designs/${createdDesignId}`,
        { headers: adminHeaders.headers }
      );
      expect(adminGetResp.status).toBe(200);
      const updatedDesign = adminGetResp.data.design;

      // Layers saved in metadata
      expect(updatedDesign.metadata?.layers).toHaveLength(1);
      expect(updatedDesign.metadata?.layers[0].fill).toBe("#00ff00");

      // Moodboard updated too
      expect(updatedDesign.moodboard).toBeDefined();
      const updatedLayerElement = updatedDesign.moodboard.elements.find(
        (el: any) => el.id === "layer-test-layer-1-1234567890"
      );
      expect(updatedLayerElement).toBeDefined();
      expect(updatedLayerElement.backgroundColor).toBe("#00ff00");
    });
  });
});
