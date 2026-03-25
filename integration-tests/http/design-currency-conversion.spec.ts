import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import type { IRegionModuleService } from "@medusajs/types";

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  resetTestCustomerCredentials,
} from "../helpers/create-customer";
import { DESIGN_MODULE } from "../../src/modules/designs";

jest.setTimeout(120 * 1000);

/**
 * Integration tests for currency conversion in design-to-cart flows.
 *
 * Verifies that when a design (estimated in the store's default currency)
 * is converted to a cart in a different currency, the prices are properly
 * converted using live exchange rates (Frankfurter/ECB).
 */
setupSharedTestSuite(() => {
  describe("Design currency conversion", () => {
    let adminHeaders: { headers: Record<string, string> };
    let customerHeaders: { headers: Record<string, string> };
    let customerId: string;
    let storeDefaultCurrency: string;
    let otherCurrency: string;

    // Cached region IDs (re-checked each time)
    let cachedDefaultRegionId: string;
    let cachedOtherRegionId: string;

    // Helper to POST and log errors instead of throwing
    async function safePost(api: any, url: string, body: any, headers: any) {
      try {
        return await api.post(url, body, headers);
      } catch (err: any) {
        console.error(`[CurrencyTest] POST ${url} →`, {
          status: err.response?.status,
          body: JSON.stringify(err.response?.data)?.slice(0, 500),
        });
        return err.response;
      }
    }

    // Helper: ensure region exists (check + create if needed)
    async function ensureRegion(currencyCode: string): Promise<string> {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();

      const regionsRes = await api.get("/admin/regions", adminHeaders);
      const existing = regionsRes.data.regions?.find(
        (r: any) => r.currency_code === currencyCode
      );
      if (existing) return existing.id;

      const regionService = container.resolve(Modules.REGION) as IRegionModuleService;
      const countryCode = currencyCode === "inr" ? "in" : currencyCode === "eur" ? "de" : "us";
      const created = await regionService.createRegions({
        name: `Region ${currencyCode.toUpperCase()}`,
        currency_code: currencyCode,
        countries: [countryCode],
      });
      return created.id;
    }

    // Helper: create a design linked to the test customer
    async function createLinkedDesign(suffix: string): Promise<string> {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Currency Test ${suffix} ${Date.now()}`,
          description: "Test design for currency conversion",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 5000,
        },
        adminHeaders
      );
      expect(designRes.status).toBe(201);
      const designId = designRes.data.design.id;

      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any;
      await remoteLink.create({
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.CUSTOMER]: { customer_id: customerId },
      });

      return designId;
    }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv();
      const container = getContainer();

      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);

      // Determine the store's default currency
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any;
      const { data: stores } = await query.graph({
        entity: "store",
        filters: {},
        fields: ["supported_currencies.currency_code", "supported_currencies.is_default"],
      });
      const defaultSc = stores?.[0]?.supported_currencies?.find((sc: any) => sc.is_default);
      storeDefaultCurrency = (defaultSc?.currency_code || "eur").toLowerCase();
      otherCurrency = storeDefaultCurrency === "inr" ? "eur" : "inr";

      console.log(`[CurrencyTest] Store default: ${storeDefaultCurrency}, other: ${otherCurrency}`);
    });

    beforeEach(async () => {
      const { getContainer } = getSharedTestEnv();
      const container = getContainer();

      // Fresh customer per test (ensures publishable API key works for store routes)
      resetTestCustomerCredentials();
      const { customer } = await createTestCustomer(container);
      customerId = customer.id;
      customerHeaders = await getCustomerAuthHeaders();

      // Ensure regions exist (re-checked each test, created if missing)
      cachedDefaultRegionId = await ensureRegion(storeDefaultCurrency);
      cachedOtherRegionId = await ensureRegion(otherCurrency);
    });

    describe("POST /admin/customers/:id/design-order (draft order workflow)", () => {
      it("should create cart without conversion when currency matches store default", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("no-conv");

        const response = await safePost(
          api,
          `/admin/customers/${customerId}/design-order`,
          { design_ids: [designId], currency_code: storeDefaultCurrency },
          adminHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.cart).toBeDefined();
        expect(response.data.cart.currency_code).toBe(storeDefaultCurrency);

        const cartService = getSharedTestEnv()
          .getContainer()
          .resolve(Modules.CART) as any;
        const lineItems = await cartService.listLineItems({
          cart_id: response.data.cart.id,
        });
        expect(lineItems.length).toBeGreaterThanOrEqual(1);

        const lineItem = lineItems[0];
        expect(lineItem.metadata?.design_id).toBe(designId);
        expect(lineItem.metadata?.original_currency).toBeUndefined();
      });

      it("should convert prices when creating cart in a different currency", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("conv");

        const response = await safePost(
          api,
          `/admin/customers/${customerId}/design-order`,
          { design_ids: [designId], currency_code: otherCurrency },
          adminHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.cart).toBeDefined();
        expect(response.data.cart.currency_code).toBe(otherCurrency);

        const cartService = getSharedTestEnv()
          .getContainer()
          .resolve(Modules.CART) as any;
        const lineItems = await cartService.listLineItems({
          cart_id: response.data.cart.id,
        });
        expect(lineItems.length).toBeGreaterThanOrEqual(1);

        const lineItem = lineItems[0];
        expect(lineItem.metadata?.design_id).toBe(designId);
        expect(lineItem.unit_price).toBeGreaterThan(0);
        expect(lineItem.unit_price).not.toBe(5000);
        expect(lineItem.metadata?.original_currency).toBe(storeDefaultCurrency);
        expect(typeof lineItem.metadata?.original_amount).toBe("number");
      });

      it("should convert price_overrides when target currency differs", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("override-conv");
        const overridePrice = 10000;

        const response = await safePost(
          api,
          `/admin/customers/${customerId}/design-order`,
          {
            design_ids: [designId],
            currency_code: otherCurrency,
            price_overrides: { [designId]: overridePrice },
          },
          adminHeaders
        );

        expect(response.status).toBe(200);

        const cartService = getSharedTestEnv()
          .getContainer()
          .resolve(Modules.CART) as any;
        const lineItems = await cartService.listLineItems({
          cart_id: response.data.cart.id,
        });

        const lineItem = lineItems[0];
        expect(lineItem.unit_price).toBeGreaterThan(0);
        expect(lineItem.unit_price).not.toBe(overridePrice);
        expect(lineItem.metadata?.original_amount).toBe(overridePrice);
        expect(lineItem.metadata?.original_currency).toBe(storeDefaultCurrency);
      });

      it("should not convert when price_overrides are used with same currency", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("override-no-conv");
        const overridePrice = 8000;

        const response = await safePost(
          api,
          `/admin/customers/${customerId}/design-order`,
          {
            design_ids: [designId],
            currency_code: storeDefaultCurrency,
            price_overrides: { [designId]: overridePrice },
          },
          adminHeaders
        );

        expect(response.status).toBe(200);

        const cartService = getSharedTestEnv()
          .getContainer()
          .resolve(Modules.CART) as any;
        const lineItems = await cartService.listLineItems({
          cart_id: response.data.cart.id,
        });

        const lineItem = lineItems[0];
        expect(lineItem.unit_price).toBe(overridePrice);
        expect(lineItem.metadata?.original_currency).toBeUndefined();
      });
    });

    describe("POST /store/custom/designs/:id/checkout (store checkout)", () => {
      it("should convert price when cart currency differs from store default", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("store-conv");

        const cartRes = await safePost(
          api,
          "/store/carts",
          { region_id: cachedOtherRegionId },
          customerHeaders
        );
        expect(cartRes.status).toBe(200);
        const otherCartId = cartRes.data.cart.id;

        const response = await safePost(
          api,
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: otherCartId },
          customerHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.line_item_id).toBeDefined();
        expect(response.data.currency_code).toBe(otherCurrency);
        expect(response.data.price).toBeGreaterThan(0);

        expect(response.data.cost_estimate).toBeDefined();
        expect(response.data.cost_estimate.original_currency).toBe(storeDefaultCurrency);
        expect(response.data.cost_estimate.converted_currency).toBe(otherCurrency);
        expect(response.data.cost_estimate.converted_amount).toBe(response.data.price);

        const cartCheck = await api.get(`/store/carts/${otherCartId}`, customerHeaders);
        const lineItem = cartCheck.data.cart.items.find(
          (i: any) => i.id === response.data.line_item_id
        );
        expect(lineItem).toBeDefined();
        expect(lineItem.metadata?.original_currency).toBe(storeDefaultCurrency);
        expect(lineItem.metadata?.original_amount).toBeDefined();
      });

      it("should keep price unchanged when cart currency matches store default", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("store-no-conv");

        const cartRes = await safePost(
          api,
          "/store/carts",
          { region_id: cachedDefaultRegionId },
          customerHeaders
        );
        expect(cartRes.status).toBe(200);
        const defaultCartId = cartRes.data.cart.id;

        const response = await safePost(
          api,
          `/store/custom/designs/${designId}/checkout`,
          { cart_id: defaultCartId },
          customerHeaders
        );

        expect(response.status).toBe(200);
        expect(response.data.line_item_id).toBeDefined();
        expect(response.data.currency_code).toBe(storeDefaultCurrency);
        expect(response.data.price).toBeGreaterThan(0);
      });
    });

    describe("Currency conversion consistency", () => {
      it("should produce converted prices via both admin and store flows", async () => {
        const { api } = getSharedTestEnv();
        const designId = await createLinkedDesign("consistency-admin");

        // Flow 1: Admin draft order in other currency with override
        const adminRes = await safePost(
          api,
          `/admin/customers/${customerId}/design-order`,
          {
            design_ids: [designId],
            currency_code: otherCurrency,
            price_overrides: { [designId]: 5000 },
          },
          adminHeaders
        );
        expect(adminRes.status).toBe(200);

        const cartService = getSharedTestEnv()
          .getContainer()
          .resolve(Modules.CART) as any;
        const adminLineItems = await cartService.listLineItems({
          cart_id: adminRes.data.cart.id,
        });
        const adminPrice = adminLineItems[0].unit_price;

        // Flow 2: Store checkout in other currency cart
        const designId2 = await createLinkedDesign("consistency-store");
        const cartRes = await safePost(
          api,
          "/store/carts",
          { region_id: cachedOtherRegionId },
          customerHeaders
        );
        expect(cartRes.status).toBe(200);

        const storeRes = await safePost(
          api,
          `/store/custom/designs/${designId2}/checkout`,
          { cart_id: cartRes.data.cart.id },
          customerHeaders
        );
        expect(storeRes.status).toBe(200);

        // Both flows should produce converted prices
        expect(adminPrice).toBeGreaterThan(0);
        expect(adminPrice).not.toBe(5000);
        expect(storeRes.data.price).toBeGreaterThan(0);
      });
    });
  });
});
