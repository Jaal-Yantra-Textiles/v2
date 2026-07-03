import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";
import { shiprocketStubState } from "../../src/modules/shipping-providers/shiprocket/stub-fetch";

jest.setTimeout(60000);

/**
 * End-to-end coverage for the inventory-order → Shiprocket shipment fixes:
 *   - #864 destination address resolved from the to-location (billing_* filled)
 *   - #869 L/B/H reach the courier (breadth → width mapping)
 *   - #866 real per-line inventory_item SKU on order_items
 *   - #641-inv courier rates endpoint (serviceability)
 *
 * Shiprocket has no sandbox; `SHIPROCKET_STUB=1` injects a deterministic
 * transport (`shiprocket/stub-fetch.ts`) that also CAPTURES the adhoc-create
 * body, so we can assert the exact payload the client would send.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();

  let headers: any;
  let inventoryItemId: string;
  let toLocationId: string;
  let fromLocationId: string;

  let prevEmail: string | undefined;
  let prevPassword: string | undefined;
  let prevStub: string | undefined;

  const TO_ADDRESS = {
    address_1: "9 Mill Rd",
    city: "Surat",
    province: "GJ",
    postal_code: "395003",
    country_code: "in",
    phone: "8887776665",
  };

  beforeAll(() => {
    prevEmail = process.env.SHIPROCKET_EMAIL;
    prevPassword = process.env.SHIPROCKET_PASSWORD;
    prevStub = process.env.SHIPROCKET_STUB;
    process.env.SHIPROCKET_EMAIL = "test@shiprocket.example";
    process.env.SHIPROCKET_PASSWORD = "secret";
    process.env.SHIPROCKET_STUB = "1";
  });

  afterAll(() => {
    if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL;
    else process.env.SHIPROCKET_EMAIL = prevEmail;
    if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD;
    else process.env.SHIPROCKET_PASSWORD = prevPassword;
    if (prevStub === undefined) delete process.env.SHIPROCKET_STUB;
    else process.env.SHIPROCKET_STUB = prevStub;
  });

  beforeEach(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);
    shiprocketStubState.lastAdhocBody = undefined;

    const item = await api.post(
      "/admin/inventory-items",
      { title: "Tangaliya Weave — Black", sku: "OTH-TAN-BLA-001" },
      headers
    );
    inventoryItemId = item.data.inventory_item.id;

    // Destination stock location carries a complete address (the #864 source).
    const toLoc = await api.post(
      "/admin/stock-locations",
      { name: "Surat Warehouse", address: TO_ADDRESS },
      headers
    );
    toLocationId = toLoc.data.stock_location.id;

    const fromLoc = await api.post(
      "/admin/stock-locations",
      { name: "Jaipur Source" },
      headers
    );
    fromLocationId = fromLoc.data.stock_location.id;
  });

  const createShippableOrder = async (): Promise<string> => {
    const res = await api.post(
      "/admin/inventory-orders",
      {
        order_lines: [
          { inventory_item_id: inventoryItemId, quantity: 3, price: 100 },
        ],
        quantity: 3,
        total_price: 300,
        status: "Ready for Delivery",
        expected_delivery_date: new Date().toISOString(),
        order_date: new Date().toISOString(),
        shipping_address: {},
        stock_location_id: toLocationId,
        from_stock_location_id: fromLocationId,
      },
      headers
    );
    expect(res.status).toBe(201);
    return res.data.inventoryOrder.id;
  };

  describe("GET /admin/inventory-orders/:id/shiprocket-rates (#641-inv)", () => {
    it("returns the Shiprocket courier options for the order", async () => {
      const id = await createShippableOrder();
      const res = await api.get(
        `/admin/inventory-orders/${id}/shiprocket-rates`,
        headers
      );
      expect(res.status).toBe(200);
      expect(res.data.destination_pincode).toBe(TO_ADDRESS.postal_code);
      expect(Array.isArray(res.data.rates)).toBe(true);
      expect(res.data.rates.length).toBeGreaterThan(0);
      const recommended = res.data.rates.find((r: any) => r.is_recommended);
      expect(recommended).toBeTruthy();
      expect(recommended.courier_id).toBe(51);
    });
  });

  describe("POST /admin/inventory-orders/:id/shipment — payload to the courier", () => {
    it("fills billing address from the to-location, maps breadth, carries the SKU", async () => {
      const id = await createShippableOrder();

      const res = await api.post(
        `/admin/inventory-orders/${id}/shipment`,
        { dimensions_cm: { length: 30, breadth: 20, height: 10 }, weight_grams: 750 },
        headers
      );
      expect(res.status).toBe(200);
      expect(res.data.shipment.awb).toBe("STUBAWB123");

      const body = shiprocketStubState.lastAdhocBody;
      expect(body).toBeTruthy();
      // #864 — destination billing address came from the to-location.
      expect(body.billing_address).toBe(TO_ADDRESS.address_1);
      expect(body.billing_pincode).toBe(TO_ADDRESS.postal_code);
      expect(body.billing_city).toBe(TO_ADDRESS.city);
      expect(body.billing_phone).toBe(TO_ADDRESS.phone);
      // #869 — breadth (cm) reaches the courier (mapped from breadth → width).
      expect(body.length).toBe(30);
      expect(body.breadth).toBe(20);
      expect(body.height).toBe(10);
      expect(body.weight).toBeCloseTo(0.75);
      // #866 — the real inventory_item SKU rides on the order item.
      expect(Array.isArray(body.order_items)).toBe(true);
      expect(body.order_items[0].sku).toBe("OTH-TAN-BLA-001");
      expect(body.order_items[0].units).toBe(3);
    });
  });
});
