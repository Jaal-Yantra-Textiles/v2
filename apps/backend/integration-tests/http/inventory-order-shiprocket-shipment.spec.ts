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
    shiprocketStubState.lastPickupBody = undefined;
    shiprocketStubState.lastAddPickupBody = undefined;

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

    // The source must be registerable as a carrier pickup (phone + pincode) —
    // there is no fallback to another party's warehouse anymore.
    const fromLoc = await api.post(
      "/admin/stock-locations",
      {
        name: "Jaipur Source",
        address: {
          address_1: "2 Block Print Bazaar",
          city: "Jaipur",
          province: "RJ",
          postal_code: "302001",
          country_code: "in",
          phone: "9998887771",
        },
      },
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

    it("schedules the carrier pickup for the requested date", async () => {
      const id = await createShippableOrder();

      const res = await api.post(
        `/admin/inventory-orders/${id}/shipment`,
        { pickup_date: "2026-07-05" },
        headers
      );
      expect(res.status).toBe(200);

      // The pickup was scheduled for the requested date and the result is
      // surfaced on the shipment.
      const pickupBody = shiprocketStubState.lastPickupBody;
      expect(pickupBody).toBeTruthy();
      expect(pickupBody.pickup_date).toEqual(["2026-07-05"]);
      expect(res.data.shipment.pickup?.scheduled_date).toBe("2026-07-05 10:00:00");
    });

    it("does not schedule a pickup when no date is given", async () => {
      const id = await createShippableOrder();

      const res = await api.post(
        `/admin/inventory-orders/${id}/shipment`,
        { weight_grams: 500 },
        headers
      );
      expect(res.status).toBe(200);
      // No pickup date → no pickup scheduling call (Shiprocket auto-slots).
      expect(shiprocketStubState.lastPickupBody).toBeUndefined();
      expect(res.data.shipment.pickup).toBeUndefined();
    });
  });

  describe("pickup derivation + shipment persistence (#772 follow-up)", () => {
    it("ships from the order's from_location and persists a first-class shipment record", async () => {
      // A from-location with a complete address is registerable as a pickup —
      // the shipment must originate THERE, not at whatever pickup happens to
      // be first on the shared Shiprocket account (the wrong-warehouse bug).
      const fromLoc = await api.post(
        "/admin/stock-locations",
        {
          name: "Partner Loom Shed",
          address: {
            address_1: "4 Weaver Lane",
            city: "Bhuj",
            province: "GJ",
            postal_code: "370001",
            country_code: "in",
            phone: "7776665554",
          },
        },
        headers
      );
      const registerableFromId = fromLoc.data.stock_location.id;
      const nickname = `warehouse-${registerableFromId.slice(-8)}`;

      const order = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 2, price: 100 },
          ],
          quantity: 2,
          total_price: 200,
          status: "Ready for Delivery",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: toLocationId,
          from_stock_location_id: registerableFromId,
        },
        headers
      );
      const id = order.data.inventoryOrder.id;

      const res = await api.post(
        `/admin/inventory-orders/${id}/shipment`,
        { weight_grams: 500 },
        headers
      );
      expect(res.status).toBe(200);

      // The from-location was auto-registered as the carrier pickup…
      const addBody = shiprocketStubState.lastAddPickupBody;
      expect(addBody).toBeTruthy();
      expect(addBody.pickup_location).toBe(nickname);
      expect(addBody.pin_code).toBe("370001");
      // …and the shipment was created against it (not warehouse-primary).
      expect(shiprocketStubState.lastAdhocBody.pickup_location).toBe(nickname);

      // The shipment is now a queryable record on the order.
      const detail = await api.get(`/admin/inventory-orders/${id}`, headers);
      const shipments = detail.data.inventoryOrder.shipments;
      expect(Array.isArray(shipments)).toBe(true);
      expect(shipments.length).toBe(1);
      expect(shipments[0].carrier).toBe("shiprocket");
      expect(shipments[0].awb).toBe("STUBAWB123");
      expect(shipments[0].pickup_location_name).toBe(nickname);
      expect(shipments[0].pickup_stock_location_id).toBe(registerableFromId);
      expect(shipments[0].status).toBe("created");
    });

    it("uses the warehouse key already recorded on the from_location's metadata without re-registering", async () => {
      // A location that carries the Shiprocket nickname in its metadata (the
      // admin registered it earlier) ships against that key directly — even
      // with no address on file, and with zero addpickup calls.
      const fromLoc = await api.post(
        "/admin/stock-locations",
        {
          name: "Pre-registered Shed",
          metadata: { shiprocket_pickup_location: "warehouse-primary" },
        },
        headers
      );
      const preRegisteredId = fromLoc.data.stock_location.id;

      const order = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 1, price: 100 },
          ],
          quantity: 1,
          total_price: 100,
          status: "Ready for Delivery",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: toLocationId,
          from_stock_location_id: preRegisteredId,
        },
        headers
      );
      const id = order.data.inventoryOrder.id;

      const res = await api.post(
        `/admin/inventory-orders/${id}/shipment`,
        { weight_grams: 500 },
        headers
      );
      expect(res.status).toBe(200);
      expect(shiprocketStubState.lastAddPickupBody).toBeUndefined();
      expect(shiprocketStubState.lastAdhocBody.pickup_location).toBe(
        "warehouse-primary"
      );

      const detail = await api.get(`/admin/inventory-orders/${id}`, headers);
      const shipments = detail.data.inventoryOrder.shipments;
      expect(shipments.length).toBe(1);
      expect(shipments[0].pickup_location_name).toBe("warehouse-primary");
      expect(shipments[0].pickup_stock_location_id).toBe(preRegisteredId);
    });

    it("rejects the shipment when the from_location cannot be registered — never ships from another party's warehouse", async () => {
      const bareLoc = await api.post(
        "/admin/stock-locations",
        { name: "Bare Shed" },
        headers
      );
      const order = await api.post(
        "/admin/inventory-orders",
        {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 1, price: 100 },
          ],
          quantity: 1,
          total_price: 100,
          status: "Ready for Delivery",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
          stock_location_id: toLocationId,
          from_stock_location_id: bareLoc.data.stock_location.id,
        },
        headers
      );
      const id = order.data.inventoryOrder.id;

      const res = await api
        .post(`/admin/inventory-orders/${id}/shipment`, { weight_grams: 500 }, headers)
        .catch((e: any) => e.response);
      expect(res.status).toBe(400);
      expect(res.data.message).toMatch(/could not be registered as a carrier pickup/);
      // Nothing shipped, nothing persisted.
      expect(shiprocketStubState.lastAdhocBody).toBeUndefined();
      const detail = await api.get(`/admin/inventory-orders/${id}`, headers);
      expect(detail.data.inventoryOrder.shipments).toEqual([]);
    });
  });
});
