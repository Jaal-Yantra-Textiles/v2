import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";
import { shiprocketStubState } from "../../src/modules/shipping-providers/shiprocket/stub-fetch";

jest.setTimeout(90000);

/**
 * #888 — carrier tracking webhook → inventory shipment/order automation.
 *
 * POST /webhooks/shipping/track receives Shiprocket status pushes:
 *   - token gate (SHIPPING_WEBHOOK_SECRET via ?token= / x-webhook-token)
 *   - unmatched AWBs are acked 200 and ignored (the account-level webhook also
 *     carries core-order shipments)
 *   - picked up → shipment picked_up + order "Shipped"
 *   - delivered → shipment delivered + order "Delivered" (Default behavior:
 *     status only; stock receipt stays a manual confirmation)
 *   - late/out-of-order pushes never regress a status
 *
 * The route acks 200 before processing, so assertions poll until the async
 * sync lands.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();

  const WEBHOOK_SECRET = "test-shipping-webhook-secret";
  const STUB_AWB = "STUBAWB123";

  let headers: any;
  let inventoryItemId: string;
  let toLocationId: string;
  let fromLocationId: string;

  let prevEmail: string | undefined;
  let prevPassword: string | undefined;
  let prevStub: string | undefined;
  let prevSecret: string | undefined;

  beforeAll(() => {
    prevEmail = process.env.SHIPROCKET_EMAIL;
    prevPassword = process.env.SHIPROCKET_PASSWORD;
    prevStub = process.env.SHIPROCKET_STUB;
    prevSecret = process.env.SHIPPING_WEBHOOK_SECRET;
    process.env.SHIPROCKET_EMAIL = "test@example.example";
    process.env.SHIPROCKET_PASSWORD = "secret";
    process.env.SHIPROCKET_STUB = "1";
    process.env.SHIPPING_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  afterAll(() => {
    if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL;
    else process.env.SHIPROCKET_EMAIL = prevEmail;
    if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD;
    else process.env.SHIPROCKET_PASSWORD = prevPassword;
    if (prevStub === undefined) delete process.env.SHIPROCKET_STUB;
    else process.env.SHIPROCKET_STUB = prevStub;
    if (prevSecret === undefined) delete process.env.SHIPPING_WEBHOOK_SECRET;
    else process.env.SHIPPING_WEBHOOK_SECRET = prevSecret;
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

    const toLoc = await api.post(
      "/admin/stock-locations",
      {
        name: "Surat Warehouse",
        address: {
          address_1: "9 Mill Rd",
          city: "Surat",
          province: "GJ",
          postal_code: "395003",
          country_code: "in",
          phone: "8887776665",
        },
      },
      headers
    );
    toLocationId = toLoc.data.stock_location.id;

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

  const createOrderWithShipment = async (): Promise<{ orderId: string; shipmentId: string }> => {
    const res = await api.post(
      "/admin/inventory-orders",
      {
        order_lines: [{ inventory_item_id: inventoryItemId, quantity: 3, price: 100 }],
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
    const orderId = res.data.inventoryOrder.id;

    const ship = await api.post(
      `/admin/inventory-orders/${orderId}/shipment`,
      { weight_grams: 500 },
      headers
    );
    expect(ship.status).toBe(200);
    const fetched = await fetchOrder(orderId);
    const shipmentId = fetched.shipments?.[0]?.id;
    expect(shipmentId).toBeTruthy();
    return { orderId, shipmentId };
  };

  const fetchOrder = async (orderId: string): Promise<any> => {
    const res = await api.get(`/admin/inventory-orders/${orderId}`, headers);
    return res.data.inventoryOrder;
  };

  /** Poll until the async webhook processing lands (route acks before syncing). */
  const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 20000): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };

  const pushTracking = async (payload: any, token: string | null = WEBHOOK_SECRET) => {
    const qs = token ? `?token=${token}` : "";
    return api
      .post(`/webhooks/shipping/track${qs}`, payload)
      .catch((e: any) => e.response);
  };

  const pickedUpPayload = (awb: string) => ({
    awb,
    courier_name: "Delhivery Surface",
    current_status: "PICKED UP",
    current_status_id: 42,
    shipment_status: "PICKED UP",
    shipment_status_id: 42,
    scans: [{ date: "2026-07-04 10:00", status: "Shipment picked up", location: "Jaipur" }],
  });

  const deliveredPayload = (awb: string) => ({
    awb,
    courier_name: "Delhivery Surface",
    current_status: "DELIVERED",
    current_status_id: 7,
    shipment_status: "DELIVERED",
    shipment_status_id: 7,
    scans: [{ date: "2026-07-06 14:00", status: "Delivered", location: "Surat" }],
  });

  it("rejects a bad or missing token with 401", async () => {
    const bad = await pushTracking(pickedUpPayload(STUB_AWB), "wrong-token");
    expect(bad.status).toBe(401);
    const missing = await pushTracking(pickedUpPayload(STUB_AWB), null);
    expect(missing.status).toBe(401);
  });

  it("acks an unmatched AWB with 200 and changes nothing", async () => {
    const { orderId } = await createOrderWithShipment();
    const res = await pushTracking(pickedUpPayload("UNKNOWNAWB999"));
    expect(res.status).toBe(200);
    // Give the async processing a moment, then confirm nothing moved.
    await new Promise((r) => setTimeout(r, 1500));
    const order = await fetchOrder(orderId);
    expect(order.status).toBe("Ready for Delivery");
  });

  it("picked up → shipment picked_up + order Shipped (existing status-changed event path)", async () => {
    const { orderId } = await createOrderWithShipment();

    const res = await pushTracking(pickedUpPayload(STUB_AWB));
    expect(res.status).toBe(200);

    const landed = await waitFor(async () => (await fetchOrder(orderId)).status === "Shipped");
    expect(landed).toBe(true);

    const order = await fetchOrder(orderId);
    const shipment = order.shipments?.[0];
    expect(shipment.status).toBe("picked_up");
    expect(Array.isArray(shipment.metadata?.tracking_events)).toBe(true);
    expect(shipment.metadata.tracking_events.length).toBeGreaterThan(0);
  });

  it("delivered → order Delivered; a late in-transit push never regresses", async () => {
    const { orderId } = await createOrderWithShipment();

    await pushTracking(pickedUpPayload(STUB_AWB));
    await waitFor(async () => (await fetchOrder(orderId)).status === "Shipped");

    const res = await pushTracking(deliveredPayload(STUB_AWB));
    expect(res.status).toBe(200);
    const delivered = await waitFor(async () => (await fetchOrder(orderId)).status === "Delivered");
    expect(delivered).toBe(true);

    // Out-of-order retry of an older scan: recorded, but nothing regresses.
    const late = await pushTracking({
      awb: STUB_AWB,
      current_status: "IN TRANSIT",
      current_status_id: 20,
      shipment_status_id: 18,
      scans: [{ date: "2026-07-05 09:00", status: "In transit", location: "Ahmedabad" }],
    });
    expect(late.status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    const order = await fetchOrder(orderId);
    expect(order.status).toBe("Delivered");
    expect(order.shipments?.[0]?.status).toBe("delivered");
  });

  it("is idempotent on webhook retries (duplicate push doesn't duplicate history)", async () => {
    const { orderId } = await createOrderWithShipment();

    await pushTracking(pickedUpPayload(STUB_AWB));
    await waitFor(async () => (await fetchOrder(orderId)).status === "Shipped");
    const before = (await fetchOrder(orderId)).shipments[0].metadata.tracking_events.length;

    await pushTracking(pickedUpPayload(STUB_AWB));
    await new Promise((r) => setTimeout(r, 1500));
    const after = (await fetchOrder(orderId)).shipments[0].metadata.tracking_events.length;
    expect(after).toBe(before);
    expect((await fetchOrder(orderId)).status).toBe("Shipped");
  });
});
