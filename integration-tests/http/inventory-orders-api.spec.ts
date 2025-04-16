import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers: any;
    let inventoryItemId: string;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create an inventory item for the order
      const newInventory = {
        title: "Test Inventory",
        description: "Test Description",
      };
      const response = await api.post("/admin/inventory-items", newInventory, headers);
      expect(response.status).toBe(200);
      inventoryItemId = response.data.inventory_item.id;
    });

    describe("POST /admin/inventory-orders", () => {
      it("should create an inventory order with valid data", async () => {
        const orderPayload = {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 2, price: 100 },
          ],
          quantity: 2,
          total_price: 200,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
        };
        
        const res = await api.post("/admin/inventory-orders", orderPayload, headers);
        expect(res.status).toBe(201);
        expect(res.data).toBeDefined();
        expect(Array.isArray(res.data.orderlines)).toBe(true);
        expect(res.data.orderlines.length).toBe(1);
        
        expect(res.data.orderlines[0].inventory_item.id).toBe(inventoryItemId);
      });

      it("should fail with missing required fields", async () => {
        const res = await api.post("/admin/inventory-orders", {}, headers).catch((err) => err.response);
        expect(res.status).toBe(400);
        console.log(res.data)
        expect(res.data || res.data).toBeDefined();
      });

      it("should fail with invalid quantity type", async () => {
        const orderPayload = {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: "two", price: 100 },
          ],
          quantity: "two",
          total_price: 200,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
        };

        const res = await api.post("/admin/inventory-orders", orderPayload, headers).catch((err) => err.response);
        expect(res.status).toBe(400);
        expect(res.data || res.data).toBeDefined();
      });

      it("should fail with negative price", async () => {
        const orderPayload = {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 2, price: -100 },
          ],
          quantity: 2,
          total_price: -200,
          status: "Pending",
          expected_delivery_date: new Date().toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {},
        };

        const res = await api.post("/admin/inventory-orders", orderPayload, headers).catch((err) => err.response);
        expect(res.status).toBe(400);
        expect(res.data || res.data).toBeDefined();
      });
    });
  },
});
