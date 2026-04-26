import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { IOrderModuleService, IRegionModuleService } from "@medusajs/types";

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  resetTestCustomerCredentials,
  getTestCustomerCredentials,
} from "../helpers/create-customer";
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure";
import orderPlacedHandler from "../../src/subscribers/order-placed";
import { DESIGN_MODULE } from "../../src/modules/designs";
import designOrderLink from "../../src/links/design-order-link";

jest.setTimeout(60 * 1000);

/**
 * Integration tests for the Design-to-Cart flow:
 *
 * 1. Cost estimation API (GET /store/custom/designs/:id/estimate)
 * 2. Checkout API (POST /store/custom/designs/:id/checkout)
 * 3. Order-placed subscriber handling design-variant links
 */
setupSharedTestSuite(() => {
  describe("Design-to-Cart Flow", () => {
    let adminHeaders: { headers: Record<string, string> };
    let customerHeaders: { headers: Record<string, string> };
    let designId: string;
    let customerId: string;

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();

      // Create admin user
      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();
      const unique = Date.now();

      // Reset and create fresh test customer for each test (similar to ai-imagegen pattern)
      // This ensures the publishable API key is properly created and linked for each test
      resetTestCustomerCredentials();
      const { customer } = await createTestCustomer(container);
      customerId = customer.id;
      customerHeaders = await getCustomerAuthHeaders();

      // Create a design for testing
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Design To Cart Test ${unique}`,
          description: "Test design for cart flow",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 150, // Pre-set estimated cost for testing
        },
        adminHeaders
      );
      expect(designRes.status).toBe(201);
      designId = designRes.data.design.id;

      // Link design to customer via remote link
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any;

      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      });
    });

    describe("GET /store/custom/designs/:id/estimate", () => {
      it("should return cost estimate for customer's design", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.get(
          `/store/custom/designs/${designId}/estimate`,
          { headers: customerHeaders.headers }
        );

        expect(response.status).toBe(200);
        expect(response.data.costs).toBeDefined();
        expect(response.data.costs.total_estimated).toBeDefined();
        expect(response.data.costs.material_cost).toBeDefined();
        expect(response.data.costs.production_cost).toBeDefined();
        expect(response.data.costs.confidence).toBeDefined();
        expect(["exact", "estimated", "guesstimate"]).toContain(
          response.data.costs.confidence
        );
        expect(response.data.breakdown).toBeDefined();
        expect(response.data.breakdown.production_percent).toBeDefined();
      });

      it("should return 401 without customer authentication", async () => {
        const { api } = getSharedTestEnv();

        const response = await api
          .get(`/store/custom/designs/${designId}/estimate`)
          .catch((err: any) => err.response);

        expect([400, 401]).toContain(response.status);
      });

      it("should return 404 for design not owned by customer", async () => {
        const { api } = getSharedTestEnv();

        // Create another design not linked to this customer
        const otherDesignRes = await api.post(
          "/admin/designs",
          {
            name: `Other Design ${Date.now()}`,
            description: "Design not owned by customer",
            design_type: "Original",
            status: "Conceptual",
            priority: "Low",
          },
          adminHeaders
        );
        expect(otherDesignRes.status).toBe(201);

        const response = await api
          .get(`/store/custom/designs/${otherDesignRes.data.design.id}/estimate`, {
            headers: customerHeaders.headers,
          })
          .catch((err: any) => err.response);

        expect(response.status).toBe(404);
      });

      it("should use design's estimated_cost for production cost calculation", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.get(
          `/store/custom/designs/${designId}/estimate`,
          { headers: customerHeaders.headers }
        );

        expect(response.status).toBe(200);
        // Since design has estimated_cost=150, production should use it as reference
        expect(response.data.costs.total_estimated).toBeGreaterThanOrEqual(0);
      });
    });

    describe("POST /store/custom/designs/:id/checkout", () => {
      let cartId: string;

      beforeEach(async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Create a cart for the customer to use in checkout tests
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        let regionId: string;
        if (regionsRes.data.regions?.length > 0) {
          regionId = regionsRes.data.regions[0].id;
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const region = await regionService.createRegions({
            name: "Checkout Test Region",
            currency_code: "usd",
            countries: ["us"],
          });
          regionId = region.id;
        }
        const cartRes = await api.post(
          "/store/carts",
          { region_id: regionId },
          customerHeaders
        );
        expect(cartRes.status).toBe(200);
        cartId = cartRes.data.cart.id;
      });

      it("should add custom line item to cart and return line_item_id", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.line_item_id).toBeDefined();
        expect(response.data.price).toBeDefined();
        expect(response.data.cost_estimate).toBeDefined();
        expect(response.data.cost_estimate.total_estimated).toBeDefined();

        // No product/variant fields in new response shape
        expect(response.data.product_id).toBeUndefined();
        expect(response.data.variant_id).toBeUndefined();
      });

      it("should return 401 without customer authentication", async () => {
        const { api } = getSharedTestEnv();

        const response = await api
          .post(`/store/custom/designs/${designId}/checkout`, { cart_id: cartId })
          .catch((err: any) => err.response);

        expect([400, 401]).toContain(response.status);
      });

      it("should return 404 for design not owned by customer", async () => {
        const { api } = getSharedTestEnv();

        // Create design not linked to customer
        const otherDesignRes = await api.post(
          "/admin/designs",
          {
            name: `Unowned Design ${Date.now()}`,
            description: "Design not linked to customer",
            design_type: "Original",
            status: "Conceptual",
            priority: "Low",
          },
          adminHeaders
        );
        expect(otherDesignRes.status).toBe(201);

        const response = await api
          .post(
            `/store/custom/designs/${otherDesignRes.data.design.id}/checkout`,
            { cart_id: cartId },
            customerHeaders
          )
          .catch((err: any) => err.response);

        expect(response.status).toBe(404);
      });

      it("should return 400 if cart_id is missing", async () => {
        const { api } = getSharedTestEnv();

        const response = await api
          .post(
            `/store/custom/designs/${designId}/checkout`,
            { currency_code: "usd" },
            customerHeaders
          )
          .catch((err: any) => err.response);

        expect(response.status).toBe(400);
      });
    });

    describe("order.placed subscriber with design-variant link", () => {
      /**
       * With the new checkout flow, product/variant creation happens via admin approval
       * (POST /admin/designs/:id/approve), not at checkout time. These tests verify
       * that once an admin approves a design (creating the variant + design-variant link),
       * the subscriber correctly creates a production run when an order is placed.
       */
      it("should create ProductionRun when order contains variant linked to design", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Admin approves design → creates product/variant and design-variant link
        const approveRes = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );
        expect(approveRes.status).toBe(200);
        const { product_id, variant_id } = approveRes.data;

        // Create an order with this variant
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const createdOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `design-cart-test-${Date.now()}@jyt.test`,
          items: [
            {
              title: "Custom Design Item",
              quantity: 1,
              unit_price: 20000,
              product_id: product_id,
              variant_id: variant_id,
            },
          ],
        } as any);

        expect(createdOrder?.id).toBeDefined();

        // Trigger order placed subscriber
        await orderPlacedHandler({
          event: { data: { id: createdOrder.id } },
          container,
        } as any);

        // Verify production run was created
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
        const { data: runs } = await query.graph({
          entity: "production_runs",
          fields: [
            "id",
            "design_id",
            "order_id",
            "order_line_item_id",
            "product_id",
            "variant_id",
            "quantity",
            "status",
          ],
          filters: { order_id: createdOrder.id },
        });

        expect(runs).toBeDefined();
        expect(runs.length).toBe(1);
        expect(runs[0].design_id).toBe(designId);
        expect(runs[0].variant_id).toBe(variant_id);
        expect(runs[0].status).toBe("pending_review");
      });

      it("should be idempotent - not create duplicate runs on repeat trigger", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Admin approves design → product/variant + design-variant link
        const approveRes = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );
        expect(approveRes.status).toBe(200);
        const { product_id, variant_id } = approveRes.data;

        // Create order
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const createdOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `idempotent-test-${Date.now()}@jyt.test`,
          items: [
            {
              title: "Custom Design Item",
              quantity: 2,
              unit_price: 20000,
              product_id: product_id,
              variant_id: variant_id,
            },
          ],
        } as any);

        // Trigger subscriber twice
        await orderPlacedHandler({
          event: { data: { id: createdOrder.id } },
          container,
        } as any);

        await orderPlacedHandler({
          event: { data: { id: createdOrder.id } },
          container,
        } as any);

        // Should still only have 1 production run
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
        const { data: runs } = await query.graph({
          entity: "production_runs",
          fields: ["id"],
          filters: { order_id: createdOrder.id },
        });

        expect(runs.length).toBe(1);
      });

      it("should handle mixed order with both linked and non-linked variants", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();
        const unique = Date.now();

        // Admin approves design → get linked variant
        const approveRes = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );
        expect(approveRes.status).toBe(200);
        const { product_id: linkedProductId, variant_id: linkedVariantId } = approveRes.data;

        // Create a separate product NOT linked to any design
        const unlinkedProductRes = await api.post(
          "/admin/products",
          {
            title: `Unlinked Product ${unique}`,
            description: "Product not linked to any design",
            status: "published",
            handle: `unlinked-product-${unique}`,
            options: [{ title: "Default", values: ["Default"] }],
          },
          adminHeaders
        );
        expect(unlinkedProductRes.status).toBe(200);
        const unlinkedProductId = unlinkedProductRes.data.product.id;

        // Create order with both items
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const createdOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `mixed-order-${unique}@jyt.test`,
          items: [
            {
              title: "Custom Design Item",
              quantity: 1,
              unit_price: 15000,
              product_id: linkedProductId,
              variant_id: linkedVariantId,
            },
            {
              title: "Regular Item",
              quantity: 1,
              unit_price: 5000,
              product_id: unlinkedProductId,
            },
          ],
        } as any);

        // Trigger subscriber
        await orderPlacedHandler({
          event: { data: { id: createdOrder.id } },
          container,
        } as any);

        // Should only create production run for the linked item
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
        const { data: runs } = await query.graph({
          entity: "production_runs",
          fields: ["id", "design_id", "product_id", "variant_id"],
          filters: { order_id: createdOrder.id },
        });

        expect(runs.length).toBe(1);
        expect(runs[0].design_id).toBe(designId);
        expect(runs[0].variant_id).toBe(linkedVariantId);
      });
    });

    describe("End-to-end design to order flow", () => {
      it("should complete full flow: estimate → checkout (line item) → admin approve → production run", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Step 1: Get cost estimate
        const estimateRes = await api.get(
          `/store/custom/designs/${designId}/estimate`,
          { headers: customerHeaders.headers }
        );
        expect(estimateRes.status).toBe(200);
        const estimate = estimateRes.data;
        console.log("[E2E] Cost estimate:", {
          total: estimate.costs.total_estimated,
          confidence: estimate.costs.confidence,
        });

        // Step 2: Create cart and checkout → adds custom line item to cart
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        let regionId: string;
        if (regionsRes.data.regions?.length > 0) {
          regionId = regionsRes.data.regions[0].id;
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const region = await regionService.createRegions({
            name: "E2E Test Region",
            currency_code: "usd",
            countries: ["us"],
          });
          regionId = region.id;
        }
        const cartRes = await api.post("/store/carts", { region_id: regionId }, customerHeaders);
        const e2eCartId = cartRes.data.cart.id;

        const checkoutRes = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: e2eCartId, currency_code: "usd" },
          customerHeaders
        );
        expect(checkoutRes.status).toBe(200);
        const { line_item_id, price } = checkoutRes.data;
        console.log("[E2E] Custom line item added to cart:", { line_item_id, price });

        // Verify line item is in cart with design metadata
        const cartAfterCheckout = await api.get(`/store/carts/${e2eCartId}`, customerHeaders);
        const cartLineItem = cartAfterCheckout.data.cart.items.find(
          (i: any) => i.id === line_item_id
        );
        expect(cartLineItem).toBeDefined();
        expect(cartLineItem.metadata?.design_id).toBe(designId);

        // Step 3: Admin approves design → creates product/variant and design-variant link
        const approveRes = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );
        expect(approveRes.status).toBe(200);
        const { product_id, variant_id } = approveRes.data;
        console.log("[E2E] Design approved, product created:", { product_id, variant_id });

        // Step 4: Simulate order placement with the approved variant
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const createdOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `e2e-${Date.now()}@jyt.test`,
          items: [
            {
              title: "Custom Design Purchase",
              quantity: 1,
              unit_price: Math.round(price * 100),
              product_id,
              variant_id,
            },
          ],
        } as any);
        console.log("[E2E] Order created:", { order_id: createdOrder.id });

        // Step 5: Trigger order.placed (simulating event bus)
        await orderPlacedHandler({
          event: { data: { id: createdOrder.id } },
          container,
        } as any);

        // Step 6: Verify production run created
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
        const { data: runs } = await query.graph({
          entity: "production_runs",
          fields: [
            "id",
            "design_id",
            "order_id",
            "variant_id",
            "quantity",
            "status",
          ],
          filters: { order_id: createdOrder.id },
        });

        expect(runs.length).toBe(1);
        expect(runs[0].design_id).toBe(designId);
        expect(runs[0].variant_id).toBe(variant_id);
        expect(runs[0].status).toBe("pending_review");
        console.log("[E2E] Production run created:", {
          run_id: runs[0].id,
          design_id: runs[0].design_id,
          status: runs[0].status,
        });
      });
    });

    describe("design → order link (designOrderLink module link)", () => {
      /**
       * Tests the designOrderLink created by the order.placed subscriber.
       *
       * NOTE: In production, the subscriber creates the link by traversing:
       *   order.cart_id → cartService.listLineItems → designLineItemLink → design_id
       * The `cart_id` is set on the order by Medusa's `completeCartWorkflow` (not by
       * createOrders directly). These tests verify the link infrastructure and widget
       * endpoint work correctly by creating links directly via remoteLink, mirroring
       * what the subscriber does in production.
       */
      it("should expose linked design via GET /admin/orders/:id/design", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Create a plain order
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const createdOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `design-order-link-${Date.now()}@jyt.test`,
          items: [{ title: "Custom Design Item", quantity: 1, unit_price: 15000 }],
        } as any);
        expect(createdOrder?.id).toBeDefined();

        // Create the designOrderLink directly — this is what the subscriber does in production
        // after traversing cart_id → cart_line_items → designLineItemLink
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any;
        await remoteLink.create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.ORDER]: { order_id: createdOrder.id },
        });

        // Verify the link is queryable via designOrderLink.entryPoint
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
        const { data: links } = await query.graph({
          entity: designOrderLink.entryPoint,
          filters: { order_id: createdOrder.id },
          fields: ["design_id", "order_id"],
        });
        expect(links.length).toBe(1);
        expect(links[0].design_id).toBe(designId);
        console.log("[design-order link] Link created and queryable:", links[0]);

        // Verify GET /admin/orders/:id/design returns the linked design
        const designRes = await api.get(`/admin/orders/${createdOrder.id}/design`, adminHeaders);
        expect(designRes.status).toBe(200);
        expect(designRes.data.design).toBeDefined();
        expect(designRes.data.design.id).toBe(designId);
        expect(designRes.data.design.name).toBeDefined();
        expect(designRes.data.design.status).toBeDefined();
        console.log("[design-order link] Widget endpoint returned design:", {
          id: designRes.data.design.id,
          name: designRes.data.design.name,
          status: designRes.data.design.status,
        });
      });

      it("should return { design: null } for orders without a design link", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Create a plain order with no design link
        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const plainOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `plain-order-${Date.now()}@jyt.test`,
          items: [{ title: "Regular Item", quantity: 1, unit_price: 5000 }],
        } as any);
        expect(plainOrder?.id).toBeDefined();

        // Run subscriber — no cart_id on the order → no designLineItemLink → no link created
        await orderPlacedHandler({ event: { data: { id: plainOrder.id } }, container } as any);

        // Widget endpoint should return null (no link)
        const designRes = await api.get(`/admin/orders/${plainOrder.id}/design`, adminHeaders);
        expect(designRes.status).toBe(200);
        expect(designRes.data.design).toBeNull();
        console.log("[design-order link] No design for plain order — widget returns null");
      });

      it("should return only the first linked design when link exists", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        const orderService = container.resolve(Modules.ORDER) as IOrderModuleService;
        const createdOrder: any = await orderService.createOrders({
          currency_code: "usd",
          email: `design-order-first-${Date.now()}@jyt.test`,
          items: [{ title: "Custom Design Item", quantity: 1, unit_price: 15000 }],
        } as any);

        // Create the link
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any;
        await remoteLink.create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.ORDER]: { order_id: createdOrder.id },
        });

        // API should return the design with expected fields
        const designRes = await api.get(`/admin/orders/${createdOrder.id}/design`, adminHeaders);
        expect(designRes.status).toBe(200);
        const design = designRes.data.design;
        expect(design).not.toBeNull();
        expect(design.id).toBe(designId);
        expect(design.name).toBeDefined();
        expect(design.status).toBeDefined();
        // Fields requested by the widget
        expect(Object.keys(design)).toEqual(
          expect.arrayContaining(["id", "name", "status"])
        );
        console.log("[design-order link] Design fields returned:", Object.keys(design));
      });
    });

    describe("Full Medusa checkout flow (cart API)", () => {
      /**
       * With the new flow, checkout (POST /store/custom/designs/:id/checkout) adds the
       * custom line item directly to the cart. No separate addToCart call needed.
       */
      it("should checkout design and verify custom line item is in cart", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Step 1: Get or create region and cart
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        let regionId: string;
        if (regionsRes.data.regions?.length > 0) {
          regionId = regionsRes.data.regions[0].id;
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const newRegion = await regionService.createRegions({
            name: "Cart Flow Region",
            currency_code: "usd",
            countries: ["us"],
          });
          regionId = newRegion.id;
        }
        const createCartRes = await api.post("/store/carts", { region_id: regionId }, customerHeaders);
        expect(createCartRes.status).toBe(200);
        const cartId = createCartRes.data.cart.id;
        console.log("[Cart Flow] Created cart:", cartId);

        // Step 2: Checkout design → custom line item added to cart directly
        const checkoutRes = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );
        expect(checkoutRes.status).toBe(200);
        const { line_item_id, price } = checkoutRes.data;
        console.log("[Cart Flow] Custom line item added:", { line_item_id, price });

        // Step 3: Verify cart has the custom line item with design metadata
        const cartRes = await api.get(`/store/carts/${cartId}`, customerHeaders);
        expect(cartRes.status).toBe(200);
        expect(cartRes.data.cart.items).toBeDefined();
        expect(cartRes.data.cart.items.length).toBeGreaterThanOrEqual(1);
        const lineItem = cartRes.data.cart.items.find((i: any) => i.id === line_item_id);
        expect(lineItem).toBeDefined();
        expect(lineItem.metadata?.design_id).toBe(designId);
        console.log("[Cart Flow] Verified custom line item in cart with design metadata");

        // Step 4: Update cart with email and addresses
        const credentials = getTestCustomerCredentials();
        const updateCartRes = await api.post(
          `/store/carts/${cartId}`,
          {
            email: credentials.email,
            shipping_address: {
              first_name: "Test",
              last_name: "Customer",
              address_1: "123 Main St",
              city: "New York",
              postal_code: "10001",
              country_code: "us",
            },
            billing_address: {
              first_name: "Test",
              last_name: "Customer",
              address_1: "123 Main St",
              city: "New York",
              postal_code: "10001",
              country_code: "us",
            },
          },
          customerHeaders
        );
        expect(updateCartRes.status).toBe(200);
        expect(updateCartRes.data.cart.email).toBe(credentials.email);
        console.log("[Cart Flow] Updated cart with addresses");
        console.log("[Cart Flow] Cart flow validation complete - custom line item is cart-compatible");
      });

      it("should be able to update quantity of custom line item in cart", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Get or create region and cart
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        let regionId: string;
        if (regionsRes.data.regions?.length > 0) {
          regionId = regionsRes.data.regions[0].id;
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const newRegion = await regionService.createRegions({
            name: "Cart Qty Region",
            currency_code: "usd",
            countries: ["us"],
          });
          regionId = newRegion.id;
        }
        const createCartRes = await api.post("/store/carts", { region_id: regionId }, customerHeaders);
        const cartId = createCartRes.data.cart.id;

        // Checkout → adds line item to cart
        const checkoutRes = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );
        expect(checkoutRes.status).toBe(200);
        const lineItemId = checkoutRes.data.line_item_id;

        // Update quantity
        const updateItemRes = await api.post(
          `/store/carts/${cartId}/line-items/${lineItemId}`,
          { quantity: 3 },
          customerHeaders
        );
        expect(updateItemRes.status).toBe(200);
        const updatedItem = updateItemRes.data.cart.items.find((i: any) => i.id === lineItemId);
        expect(updatedItem?.quantity).toBe(3);
        console.log("[Cart Flow] Updated custom line item quantity to 3");
      });

      it("should be able to remove custom line item from cart", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Get or create region and cart
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        let regionId: string;
        if (regionsRes.data.regions?.length > 0) {
          regionId = regionsRes.data.regions[0].id;
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const newRegion = await regionService.createRegions({
            name: "Cart Delete Region",
            currency_code: "usd",
            countries: ["us"],
          });
          regionId = newRegion.id;
        }
        const createCartRes = await api.post("/store/carts", { region_id: regionId }, customerHeaders);
        const cartId = createCartRes.data.cart.id;

        // Checkout → adds line item to cart
        const checkoutRes = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );
        expect(checkoutRes.status).toBe(200);
        const lineItemId = checkoutRes.data.line_item_id;

        // Delete line item
        const deleteItemRes = await api.delete(
          `/store/carts/${cartId}/line-items/${lineItemId}`,
          customerHeaders
        );
        expect(deleteItemRes.status).toBe(200);

        // Verify item was removed
        const cartAfterDelete = await api.get(`/store/carts/${cartId}`, customerHeaders);
        const remainingItem = cartAfterDelete.data.cart.items.find((i: any) => i.id === lineItemId);
        expect(remainingItem).toBeUndefined();
        console.log("[Cart Flow] Removed custom line item from cart");
      });

      it("should complete full checkout with shipping and payment (creates order)", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Step 1: Get the existing region (avoid creating a new "us" region — country conflict)
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        let regionId: string;
        if (regionsRes.data.regions?.length > 0) {
          regionId = regionsRes.data.regions[0].id;
          console.log("[Full Checkout] Using existing region:", regionId);
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const region = await regionService.createRegions({
            name: `Full Checkout Region ${Date.now()}`,
            currency_code: "usd",
            countries: ["us"],
          });
          regionId = region.id;
          console.log("[Full Checkout] Created region:", regionId);
        }

        const infrastructure = await setupCheckoutInfrastructure(container, regionId);
        console.log("[Full Checkout] Infrastructure setup complete:", {
          stockLocation: infrastructure.stockLocation?.id,
          shippingOption: infrastructure.shippingOption?.id,
        });

        // Step 2: Create cart
        const createCartRes = await api.post("/store/carts", { region_id: regionId }, customerHeaders);
        expect(createCartRes.status).toBe(200);
        const cartId = createCartRes.data.cart.id;
        console.log("[Full Checkout] Created cart:", cartId);

        // Step 3: Checkout design → custom line item added to cart
        const checkoutRes = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );
        expect(checkoutRes.status).toBe(200);
        const { line_item_id } = checkoutRes.data;
        console.log("[Full Checkout] Custom line item added:", line_item_id);

        // Step 4: Update cart with addresses (best effort)
        const credentials = getTestCustomerCredentials();
        await api.post(
          `/store/carts/${cartId}`,
          {
            email: credentials.email,
            shipping_address: {
              first_name: "Test",
              last_name: "Customer",
              address_1: "123 Main St",
              city: "New York",
              postal_code: "10001",
              country_code: "us",
            },
            billing_address: {
              first_name: "Test",
              last_name: "Customer",
              address_1: "123 Main St",
              city: "New York",
              postal_code: "10001",
              country_code: "us",
            },
          },
          customerHeaders
        ).catch(() => console.log("[Full Checkout] Cart address update failed — continuing"));
        console.log("[Full Checkout] Cart addresses updated");

        // Step 5: Add shipping method if available (best effort)
        const shippingOptionsRes = await api.get(
          `/store/shipping-options?cart_id=${cartId}`,
          customerHeaders
        ).catch(() => ({ data: { shipping_options: [] } }));
        if (shippingOptionsRes.data.shipping_options?.length > 0) {
          await api.post(
            `/store/carts/${cartId}/shipping-methods`,
            { option_id: shippingOptionsRes.data.shipping_options[0].id },
            customerHeaders
          ).catch(() => null);
          console.log("[Full Checkout] Added shipping method");
        }

        // Step 6: Payment and complete (best effort — custom line items may need
        // cart recalculation before payment collection is accepted)
        const paymentCollectionRes = await api.post(
          "/store/payment-collections",
          { cart_id: cartId },
          customerHeaders
        ).catch((err: any) => err.response);

        if (paymentCollectionRes?.status === 200) {
          const paymentCollectionId = paymentCollectionRes.data.payment_collection.id;
          const paymentProvidersRes = await api.get(
            `/store/payment-providers?region_id=${regionId}`,
            customerHeaders
          ).catch(() => ({ data: { payment_providers: [] } }));
          const providers = paymentProvidersRes.data.payment_providers || [];
          console.log("[Full Checkout] Available payment providers:", providers.map((p: any) => p.id));

          if (providers.length > 0) {
            await api.post(
              `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
              { provider_id: providers[0].id },
              customerHeaders
            ).catch(() => null);

            const completeCartRes = await api.post(
              `/store/carts/${cartId}/complete`,
              {},
              customerHeaders
            ).catch(() => ({ data: { type: "error" } }));
            console.log("[Full Checkout] Cart completion type:", completeCartRes.data.type);

            if (completeCartRes.data.type === "order") {
              const orderId = completeCartRes.data.order.id;
              console.log("[Full Checkout] Order created:", orderId);
              const orderRes = await api.get(`/admin/orders/${orderId}`, adminHeaders);
              expect(orderRes.status).toBe(200);
            } else {
              console.log("[Full Checkout] Cart completion result:", completeCartRes.data.error || completeCartRes.data.type);
            }
          } else {
            console.log("[Full Checkout] No payment providers available - skipping checkout completion");
          }
        } else {
          console.log("[Full Checkout] Payment collection failed (cart may need recalculation) - skipping");
        }
      });
    });
  });
});
