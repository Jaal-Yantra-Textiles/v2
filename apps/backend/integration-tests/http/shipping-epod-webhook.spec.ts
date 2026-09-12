import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(90000);

/**
 * Delhivery EPOD webhook — POST /webhooks/shipping/epod?carrier=delhivery.
 *
 * The proof-of-delivery sibling of /webhooks/shipping/track. Same token gate,
 * same ack-before-processing contract. The POD is stored against whichever
 * shipment owns the AWB, and because Delhivery re-push a corrected POD for the
 * same AWB, a second push must append rather than overwrite.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv();

  const WEBHOOK_SECRET = "test-shipping-webhook-secret";
  const STUB_AWB = "STUBAWB123";
  // A one-byte PDF, base64 — enough to exercise the upload path.
  const POD_B64 = "JVBERi0xLjQKJUVPRgo=";

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

    const item = await api.post(
      "/admin/inventory-items",
      { title: "Tangaliya Weave — Indigo", sku: "OTH-TAN-IND-001" },
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

  const createOrderWithShipment = async (): Promise<{ orderId: string }> => {
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
    return { orderId };
  };

  const fetchShipment = async (orderId: string): Promise<any> => {
    const res = await api.get(`/admin/inventory-orders/${orderId}`, headers);
    return res.data.inventoryOrder?.shipments?.[0];
  };

  /** Poll until the async processing lands (the route acks before storing). */
  const waitFor = async (
    predicate: () => Promise<boolean>,
    timeoutMs = 20000
  ): Promise<boolean> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };

  const pushEpod = async (payload: any, token: string | null = WEBHOOK_SECRET) => {
    const qs = `?carrier=delhivery${token ? `&token=${token}` : ""}`;
    return api
      .post(`/webhooks/shipping/epod${qs}`, payload)
      .catch((e: any) => e.response);
  };

  it("rejects a bad or missing token with 401", async () => {
    const bad = await pushEpod({ waybill: STUB_AWB, EPOD: POD_B64 }, "wrong-token");
    expect(bad.status).toBe(401);
    const missing = await pushEpod({ waybill: STUB_AWB, EPOD: POD_B64 }, null);
    expect(missing.status).toBe(401);
  });

  it("acks an unmatched AWB with 200 rather than erroring", async () => {
    // The account-level webhook carries PODs for shipments that aren't ours.
    const res = await pushEpod({ waybill: "UNKNOWNAWB999", EPOD: POD_B64 });
    expect(res.status).toBe(200);
  });

  it("acks a push with no document and stores nothing", async () => {
    const { orderId } = await createOrderWithShipment();
    const res = await pushEpod({ waybill: STUB_AWB });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 1500));
    const shipment = await fetchShipment(orderId);
    expect(shipment?.metadata?.pod).toBeFalsy();
  });

  it("stores a base64 POD against the shipment that owns the AWB", async () => {
    const { orderId } = await createOrderWithShipment();

    const res = await pushEpod({
      waybill: STUB_AWB,
      EPOD: POD_B64,
      orderID: orderId,
    });
    expect(res.status).toBe(200);

    const landed = await waitFor(async () => {
      const s = await fetchShipment(orderId);
      return Boolean(s?.metadata?.pod?.url);
    });
    expect(landed).toBe(true);

    const shipment = await fetchShipment(orderId);
    expect(shipment.metadata.pod.carrier).toBe("delhivery");
    // Uploaded to our own store, so the reference does not expire.
    expect(shipment.metadata.pod.ephemeral).toBe(false);
    expect(shipment.metadata.pod_documents).toHaveLength(1);
  });

  it("appends a corrected POD instead of destroying the first", async () => {
    // Delhivery re-push whenever their audit team uploads a revision; the
    // superseded document is still evidence of what was shown at delivery.
    const { orderId } = await createOrderWithShipment();

    await pushEpod({ waybill: STUB_AWB, EPOD: POD_B64 });
    await waitFor(async () => {
      const s = await fetchShipment(orderId);
      return Boolean(s?.metadata?.pod?.url);
    });
    const first = (await fetchShipment(orderId)).metadata.pod.url;

    await pushEpod({ waybill: STUB_AWB, EPOD: "JVBERi0xLjQKJSVFT0YK" });
    const appended = await waitFor(async () => {
      const s = await fetchShipment(orderId);
      return (s?.metadata?.pod_documents || []).length === 2;
    });
    expect(appended).toBe(true);

    const shipment = await fetchShipment(orderId);
    expect(shipment.metadata.pod_documents.map((p: any) => p.url)).toContain(first);
    expect(shipment.metadata.pod.url).not.toBe(first);
  });

  it("records a carrier link as ephemeral rather than uploading it", async () => {
    const { orderId } = await createOrderWithShipment();
    const link = "https://delhivery-pod.s3.amazonaws.com/pod.pdf?sig=abc";

    await pushEpod({ waybill: STUB_AWB, EPOD: link });
    const landed = await waitFor(async () => {
      const s = await fetchShipment(orderId);
      return Boolean(s?.metadata?.pod?.url);
    });
    expect(landed).toBe(true);

    const shipment = await fetchShipment(orderId);
    expect(shipment.metadata.pod.url).toBe(link);
    // Flagged so it is obvious the reference dies in 7 days.
    expect(shipment.metadata.pod.ephemeral).toBe(true);
  });
});
