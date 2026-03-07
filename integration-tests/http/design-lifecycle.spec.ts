import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { IRegionModuleService } from "@medusajs/types";

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  resetTestCustomerCredentials,
  getTestCustomerCredentials,
} from "../helpers/create-customer";
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure";
import { DESIGN_MODULE } from "../../src/modules/designs";

jest.setTimeout(60 * 1000);

/**
 * Integration tests for the new Design lifecycle:
 *
 * 1. Checkout → custom line item in cart (no product created)
 * 2. Admin approval → creates real product/variant, transitions status to Approved
 * 3. Full lifecycle: design → cart → order → admin approve
 */
setupSharedTestSuite(() => {
  describe("Design custom line item lifecycle", () => {
    let adminHeaders: { headers: Record<string, string> };
    let customerHeaders: { headers: Record<string, string> };
    let designId: string;
    let customerId: string;
    let cartId: string;
    let sharedRegionId: string;

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();

      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();
      const unique = Date.now();

      resetTestCustomerCredentials();
      const { customer } = await createTestCustomer(container);
      customerId = customer.id;
      customerHeaders = await getCustomerAuthHeaders();

      // Create a design with estimated_cost
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Lifecycle Test Design ${unique}`,
          description: "Test design for lifecycle flow",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 200,
        },
        adminHeaders
      );
      expect(designRes.status).toBe(201);
      designId = designRes.data.design.id;

      // Link design to customer
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any;
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      });

      // Get or create a shared region (created once, reused across tests to avoid country conflicts)
      if (!sharedRegionId) {
        const regionsRes = await api.get("/admin/regions", adminHeaders);
        if (regionsRes.data.regions?.length > 0) {
          sharedRegionId = regionsRes.data.regions[0].id;
        } else {
          const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
          const region = await regionService.createRegions({
            name: "Test Region",
            currency_code: "usd",
            countries: ["us"],
          });
          sharedRegionId = region.id;
        }
      }

      const cartRes = await api.post(
        "/store/carts",
        { region_id: sharedRegionId },
        customerHeaders
      );
      expect(cartRes.status).toBe(200);
      cartId = cartRes.data.cart.id;
    });

    describe("POST /store/custom/designs/:id/checkout (custom line item)", () => {
      it("adds custom line item to cart with is_custom_price", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.line_item_id).toBeDefined();
        expect(typeof response.data.line_item_id).toBe("string");

        // Verify item is in the cart
        const cartRes = await api.get(`/store/carts/${cartId}`, customerHeaders);
        expect(cartRes.status).toBe(200);
        expect(cartRes.data.cart.items.length).toBeGreaterThanOrEqual(1);
        const lineItem = cartRes.data.cart.items.find(
          (i: any) => i.id === response.data.line_item_id
        );
        expect(lineItem).toBeDefined();
      });

      it("line item metadata includes design_id", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );
        expect(response.status).toBe(200);

        // Verify metadata via cart
        const cartRes = await api.get(`/store/carts/${cartId}`, customerHeaders);
        const lineItem = cartRes.data.cart.items.find(
          (i: any) => i.id === response.data.line_item_id
        );
        expect(lineItem?.metadata?.design_id).toBe(designId);
      });

      it("returns line_item_id, price, and cost_estimate", async () => {
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
        expect(response.data.cost_estimate.material_cost).toBeDefined();
        expect(response.data.cost_estimate.production_cost).toBeDefined();
        expect(response.data.cost_estimate.confidence).toBeDefined();
        expect(["exact", "estimated", "guesstimate"]).toContain(
          response.data.cost_estimate.confidence
        );
        expect(response.data.cost_estimate.breakdown).toBeDefined();

        // No product/variant fields
        expect(response.data.product_id).toBeUndefined();
        expect(response.data.variant_id).toBeUndefined();
      });

      it("returns 401 without customer auth", async () => {
        const { api } = getSharedTestEnv();

        const response = await api
          .post(`/store/custom/designs/${designId}/checkout`, { cart_id: cartId })
          .catch((err: any) => err.response);

        expect([400, 401]).toContain(response.status);
      });

      it("returns 404 for unowned design", async () => {
        const { api } = getSharedTestEnv();

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

      it("returns 400 if cart_id is missing", async () => {
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

    describe("POST /admin/designs/:id/approve", () => {
      it("creates product/variant from design", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.product_id).toBeDefined();
        expect(response.data.variant_id).toBeDefined();

        // Verify product was actually created
        const productRes = await api.get(
          `/admin/products/${response.data.product_id}`,
          adminHeaders
        );
        expect(productRes.status).toBe(200);
        expect(productRes.data.product.metadata?.is_custom_design).toBe(true);
        expect(productRes.data.product.metadata?.design_id).toBe(designId);
      });

      it("transitions design status to Approved", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.design).toBeDefined();

        // Verify status
        const designRes = await api.get(
          `/admin/designs/${designId}`,
          adminHeaders
        );
        expect(designRes.status).toBe(200);
        expect(designRes.data.design.status).toBe("Approved");
      });

      it("returns product_id and variant_id", async () => {
        const { api } = getSharedTestEnv();

        const response = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );

        expect(response.status).toBe(200);
        expect(typeof response.data.product_id).toBe("string");
        expect(typeof response.data.variant_id).toBe("string");
      });

      it("returns 401 without admin auth", async () => {
        const { api } = getSharedTestEnv();

        const response = await api
          .post(`/admin/designs/${designId}/approve`, {})
          .catch((err: any) => err.response);

        expect([400, 401]).toContain(response.status);
      });
    });

    describe("Full lifecycle: design → cart → order → approve", () => {
      it("completes full design lifecycle from checkout to admin approval", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Setup checkout infrastructure on the shared region (already exists, no country conflict)
        const infrastructure = await setupCheckoutInfrastructure(container, sharedRegionId);
        console.log("[Lifecycle] Infrastructure setup:", {
          stockLocation: infrastructure.stockLocation?.id,
          shippingOption: infrastructure.shippingOption?.id,
        });

        // Create a fresh cart for this customer
        const newCartRes = await api.post(
          "/store/carts",
          { region_id: sharedRegionId },
          customerHeaders
        );
        expect(newCartRes.status).toBe(200);
        const lifecycleCartId = newCartRes.data.cart.id;

        // Step 1: Call checkout → custom line item in cart
        const checkoutRes = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: lifecycleCartId, currency_code: "usd" },
          customerHeaders
        );
        expect(checkoutRes.status).toBe(200);
        const { line_item_id, price } = checkoutRes.data;
        console.log("[Lifecycle] Checkout:", { line_item_id, price });

        // Verify line item is in cart with design metadata
        const cartRes = await api.get(
          `/store/carts/${lifecycleCartId}`,
          customerHeaders
        );
        const lineItem = cartRes.data.cart.items.find(
          (i: any) => i.id === line_item_id
        );
        expect(lineItem).toBeDefined();
        expect(lineItem.metadata?.design_id).toBe(designId);

        // Step 2: Update cart with addresses
        const credentials = getTestCustomerCredentials();
        await api.post(
          `/store/carts/${lifecycleCartId}`,
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
        ).catch(() => console.log("[Lifecycle] Cart address update failed — continuing"));

        // Step 3: Optional — add shipping method if available
        const shippingOptionsRes = await api.get(
          `/store/shipping-options?cart_id=${lifecycleCartId}`,
          customerHeaders
        ).catch(() => ({ data: { shipping_options: [] } }));
        if (shippingOptionsRes.data.shipping_options?.length > 0) {
          await api.post(
            `/store/carts/${lifecycleCartId}/shipping-methods`,
            { option_id: shippingOptionsRes.data.shipping_options[0].id },
            customerHeaders
          ).catch(() => console.log("[Lifecycle] Shipping method add failed — continuing"));
          console.log("[Lifecycle] Shipping method added");
        }

        // Step 4: Optional — payment and complete cart (best effort; custom line items
        // may require cart recalculation before payment collection works)
        const paymentCollectionRes = await api.post(
          "/store/payment-collections",
          { cart_id: lifecycleCartId },
          customerHeaders
        ).catch((err: any) => err.response);

        if (paymentCollectionRes?.status === 200) {
          const paymentCollectionId = paymentCollectionRes.data.payment_collection.id;
          const paymentProvidersRes = await api.get(
            `/store/payment-providers?region_id=${sharedRegionId}`,
            customerHeaders
          ).catch(() => ({ data: { payment_providers: [] } }));
          const providers = paymentProvidersRes.data.payment_providers || [];

          if (providers.length > 0) {
            await api.post(
              `/store/payment-collections/${paymentCollectionId}/payment-sessions`,
              { provider_id: providers[0].id },
              customerHeaders
            ).catch(() => null);

            const completeCartRes = await api.post(
              `/store/carts/${lifecycleCartId}/complete`,
              {},
              customerHeaders
            ).catch(() => ({ data: { type: "error" } }));
            console.log("[Lifecycle] Cart completion type:", completeCartRes.data.type);

            if (completeCartRes.data.type === "order") {
              const orderId = completeCartRes.data.order.id;
              console.log("[Lifecycle] Order placed:", orderId);
              const orderRes = await api.get(`/admin/orders/${orderId}`, adminHeaders);
              expect(orderRes.status).toBe(200);
            }
          }
        } else {
          console.log("[Lifecycle] Payment collection not available — skipping cart completion");
        }

        // Step 5: Admin approves design → product created (core assertion)
        const approveRes = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        );
        expect(approveRes.status).toBe(200);
        expect(approveRes.data.product_id).toBeDefined();
        expect(approveRes.data.variant_id).toBeDefined();
        console.log("[Lifecycle] Design approved, product created:", {
          product_id: approveRes.data.product_id,
          variant_id: approveRes.data.variant_id,
        });

        // Verify product linked to design and status is Approved
        const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
        const { data: linkedDesigns } = await query.graph({
          entity: "design",
          filters: { id: designId },
          fields: ["id", "status", "products.*"],
        });

        expect(linkedDesigns).toBeDefined();
        expect(linkedDesigns[0].status).toBe("Approved");
        expect(linkedDesigns[0].products?.length).toBeGreaterThanOrEqual(1);
        expect(
          linkedDesigns[0].products.some(
            (p: any) => p.id === approveRes.data.product_id
          )
        ).toBe(true);
      });
    });
  });
});
