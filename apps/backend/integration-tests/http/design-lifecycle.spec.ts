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
import { FX_FANOUT_REQUESTED } from "../../src/workflows/fx/fanout-variant-prices";

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

      // Create the customer once — reuse across all tests to avoid
      // publishable API key conflicts from multiple key creations
      resetTestCustomerCredentials();
      const { customer } = await createTestCustomer(container);
      customerId = customer.id;
      customerHeaders = await getCustomerAuthHeaders();

      // Get or create a shared region
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
    });

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();
      const unique = Date.now() + Math.random().toString(36).slice(2, 8);

      // Create a fresh design for each test
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
      ).catch((e: any) => e.response);

      if (designRes.status !== 201) {
        throw new Error(`[beforeEach] Design creation failed: ${designRes.status} ${JSON.stringify(designRes.data)}`);
      }
      designId = designRes.data.design.id;

      // Link design to customer
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any;
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      });

      cartId = "";

      // Verify the design-customer link was created (sanity check for debugging)
      const { data: verifyLinks } = await (container.resolve(ContainerRegistrationKeys.QUERY) as any).graph({
        entity: "design_customer",
        filters: { design_id: designId, customer_id: customerId },
        fields: ["design_id", "customer_id"],
      });
      if (!verifyLinks?.length) {
        console.error(`[beforeEach] WARNING: design-customer link NOT found for design=${designId} customer=${customerId}`);
      }
    });

    // Helper: lazily create a cart (only when store tests need one)
    const ensureCart = async () => {
      if (cartId) return;
      const { api } = getSharedTestEnv();
      const cartRes = await api.post(
        "/store/carts",
        { region_id: sharedRegionId },
        customerHeaders
      );
      cartId = cartRes.data.cart.id;
    };

    describe("POST /store/custom/designs/:id/checkout (custom line item)", () => {
      // IMPORTANT: The main checkout test MUST run first. Medusa's test runner
      // invalidates the publishable API key after the first store route request,
      // so error-path tests (which also hit store routes) are placed after.
      it("adds custom line item with metadata, price, and cost_estimate", async () => {
        const { api } = getSharedTestEnv();
        await ensureCart();

        const response = await api.post(
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: cartId, currency_code: "usd" },
          customerHeaders
        );

        // Basic response
        expect(response.status).toBe(200);
        expect(response.data.line_item_id).toBeDefined();
        expect(typeof response.data.line_item_id).toBe("string");

        // Price and cost estimate
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

        // No product/variant fields (product created on approval, not checkout)
        expect(response.data.product_id).toBeUndefined();
        expect(response.data.variant_id).toBeUndefined();

        // Verify item is in the cart with correct metadata
        const cartRes = await api.get(`/store/carts/${cartId}`, customerHeaders);
        expect(cartRes.status).toBe(200);
        expect(cartRes.data.cart.items.length).toBeGreaterThanOrEqual(1);
        const lineItem = cartRes.data.cart.items.find(
          (i: any) => i.id === response.data.line_item_id
        );
        expect(lineItem).toBeDefined();
        expect(lineItem?.metadata?.design_id).toBe(designId);
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
        expect(productRes.data.product.status).toBe("draft");
        expect(productRes.data.product.metadata?.is_custom_design).toBe(true);
        expect(productRes.data.product.metadata?.design_id).toBe(designId);
      });

      it("transitions design status to Approved", async () => {
        const { api } = getSharedTestEnv();

        let response: any;
        try {
          response = await api.post(
            `/admin/designs/${designId}/approve`,
            {},
            adminHeaders
          );
        } catch (e: any) {
          // Log the full error to understand what's happening
          console.log("[TEST DEBUG] Approve caught error:", e?.response?.status, JSON.stringify(e?.response?.data), "designId=", designId);
          response = e.response || { status: 999, data: { error: e.message } };
        }

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

      /**
       * 🔴 #1900 — a design with no cost must not become a product listed at 0.
       *
       * `estimated_cost || 0` reached `resolveListedPrice`, which passed the
       * zero straight through to the price row. Two such products are on prod.
       * A 0 is worse than the ×100 it replaced: a hundred-fold price is absurd
       * on sight, a free product looks plausible.
       */
      it("refuses to approve a design with no cost, and creates nothing", async () => {
        const { api } = getSharedTestEnv();
        const unique = Date.now() + Math.random().toString(36).slice(2, 8);

        const created = await api.post(
          "/admin/designs",
          {
            name: `Costless Design ${unique}`,
            description: "no estimated_cost — must not be listable",
            design_type: "Original",
            status: "Commerce_Ready",
            priority: "Medium",
          },
          adminHeaders
        );
        expect(created.status).toBe(201);
        const costlessId = created.data.design.id as string;
        expect(created.data.design.estimated_cost ?? null).toBeNull();

        const res = await api
          .post(`/admin/designs/${costlessId}/approve`, {}, adminHeaders)
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
        expect(res.data.message).toMatch(/no estimated cost/i);

        // Nothing was created, and — because the guard runs BEFORE the status
        // write — the design is not left Approved with no product behind it.
        const after = await api.get(`/admin/designs/${costlessId}`, adminHeaders);
        expect(after.data.design.status).not.toBe("Approved");
      });

      /**
       * 🔴 #1900 — every design approved here was listed in ONE currency.
       *
       * Medusa's pricing module emits no `price.created`, so a path that
       * writes a variant price must ASK for the FX fanout. This door never
       * did; the five 2026-08-28 Oshen products carry an AUD price only.
       */
      it("asks for the FX fanout so the other currencies get prices", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const eventBus: any = getContainer().resolve(Modules.EVENT_BUS);

        const seen: any[] = [];
        const handler = async (payload: any) => {
          seen.push(payload?.data ?? payload);
        };
        eventBus.subscribe(FX_FANOUT_REQUESTED, handler);

        try {
          const res = await api.post(
            `/admin/designs/${designId}/approve`,
            {},
            adminHeaders
          );
          expect(res.status).toBe(200);

          // The variant is priced, and priced above zero.
          const variantRes = await api.get(
            `/admin/products/${res.data.product_id}?fields=*variants.prices`,
            adminHeaders
          );
          const prices =
            variantRes.data.product.variants?.[0]?.prices ?? [];
          expect(prices.length).toBeGreaterThan(0);
          expect(Number(prices[0].amount)).toBeGreaterThan(0);

          // And the fanout was requested for THIS variant.
          for (let i = 0; i < 25 && !seen.length; i++) {
            await new Promise((r) => setTimeout(r, 200));
          }
          const forVariant = seen.filter((d: any) =>
            (d?.variant_ids ?? []).includes(res.data.variant_id)
          );
          expect(forVariant.length).toBeGreaterThan(0);
        } finally {
          eventBus.unsubscribe?.(FX_FANOUT_REQUESTED, handler);
        }
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
      it("completes full design lifecycle: approve links product to design", async () => {
        const { api, getContainer } = getSharedTestEnv();
        const container = getContainer();

        // Approve design → product created (uses admin API, no publishable key needed)
        const approveRes = await api.post(
          `/admin/designs/${designId}/approve`,
          {},
          adminHeaders
        ).catch((e: any) => e.response);

        expect(approveRes.status).toBe(200);
        expect(approveRes.data.product_id).toBeDefined();
        expect(approveRes.data.variant_id).toBeDefined();

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
