import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);
medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers: any;
    let inventoryItemId: string;
    let stockLocationId: string;

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
      const stockLocations = {
        name: 'Main Warehouse'
      }
      const stockLocation = await api.post("/admin/stock-locations", stockLocations, headers);
      expect(stockLocation.status).toBe(200);
      stockLocationId = stockLocation.data.stock_location.id;

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
          stock_location_id: stockLocationId,
        };
        
        const res = await api.post("/admin/inventory-orders", orderPayload, headers);
        expect(res.status).toBe(201);

        expect(res.data).toBeDefined();
        expect(Array.isArray(res.data.inventoryOrder.orderlines)).toBe(true);
        expect(res.data.inventoryOrder.orderlines.length).toBe(1);
        
        expect(res.data.inventoryOrder.orderlines[0].inventory_items[0].id).toBe(inventoryItemId);
      });

      it("should fail with missing required fields", async () => {
        const res = await api.post("/admin/inventory-orders", {}, headers).catch((err) => err.response);
        expect(res.status).toBe(400);
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
          stock_location_id: stockLocationId,
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
          stock_location_id: stockLocationId,
        };

        const res = await api.post("/admin/inventory-orders", orderPayload, headers).catch((err) => err.response);
        expect(res.status).toBe(400);
        expect(res.data || res.data).toBeDefined();
      });
    });

    type OrderLine = { inventory_item_id: string; quantity: number; price: number };
    describe("GET /admin/inventory-orders", () => {
      let createdOrders = [] as any[];
      beforeEach(async () => {
        // Create multiple inventory orders, each with unique inventory items and multiple unique orderlines
        const ordersToCreate = [
          {
            order_lines: [] as OrderLine[],
            quantity: 1,
            total_price: 50,
            status: "Pending",
            expected_delivery_date: new Date("2025-01-01").toISOString(),
            order_date: new Date("2025-01-01").toISOString(),
            shipping_address: {},
            stock_location_id: stockLocationId,
          },
          {
            order_lines: [],
            quantity: 5,
            total_price: 500,
            status: "Processing",
            expected_delivery_date: new Date("2025-02-01").toISOString(),
            order_date: new Date("2025-02-01").toISOString(),
            shipping_address: {},
            stock_location_id: stockLocationId,
          },
          {
            order_lines: [],
            quantity: 2,
            total_price: 200,
            status: "Shipped",
            expected_delivery_date: new Date("2025-03-01").toISOString(),
            order_date: new Date("2025-03-01").toISOString(),
            shipping_address: {},
            stock_location_id: stockLocationId,
          },
        ];
        createdOrders = [];
        for (const [orderIdx, order] of ordersToCreate.entries()) {
          // For each order, create 2 unique inventory items and use them as orderlines
          const orderLines: OrderLine[] = [];
          for (let i = 0; i < 2; i++) {
            const inventoryRes = await api.post("/admin/inventory-items", {
              title: `Test Inventory ${order.status} ${i} ${Math.random()}`,
              description: `Test Description ${order.status} ${i}`
            }, headers);
            expect(inventoryRes.status).toBe(200);
            const uniqueInventoryId = inventoryRes.data.inventory_item.id;
            // For the second order (index 1), set quantities to [2,3] so total is 5
            let quantity = i + 1;
            if (orderIdx === 1) {
              quantity = i === 0 ? 2 : 3;
            }
            orderLines.push({
              inventory_item_id: uniqueInventoryId,
              quantity,
              price: (i + 1) * 50
            });
          }
          order.order_lines = orderLines;
          order.quantity = orderLines.reduce((sum, l) => sum + l.quantity, 0);
          order.total_price = orderLines.reduce((sum, l) => sum + l.price, 0);
          const res = await api.post("/admin/inventory-orders", order, headers);
          expect(res.status).toBe(201);
          createdOrders.push(res.data);
        }
      });

      it("should list all inventory orders", async () => {
        const res = await api.get("/admin/inventory-orders", headers);
        expect(res.status).toBe(200);
        expect(res.data.inventory_orders.length).toBeGreaterThanOrEqual(3);
        expect(res.data.count).toBeGreaterThanOrEqual(3);
      });

      it("should filter by status", async () => {
        const res = await api.get("/admin/inventory-orders?status=Pending", headers);
        expect(res.status).toBe(200);
        expect(res.data.inventory_orders.length).toBeGreaterThanOrEqual(1);
        res.data.inventory_orders.forEach(order => {
          expect(order.status).toBe("Pending");
        });
      });

      it("should filter by quantity", async () => {
        const res = await api.get("/admin/inventory-orders?quantity=5", headers);
        expect(res.status).toBe(200);
        expect(res.data.inventory_orders.length).toBeGreaterThanOrEqual(1);
        res.data.inventory_orders.forEach(order => {
          expect(order.quantity).toBe(5);
        });
      });

      it("should filter by order_date", async () => {
        const res = await api.get("/admin/inventory-orders?order_date=2025-02-01", headers);
        expect(res.status).toBe(200);
        expect(res.data.inventory_orders.length).toBeGreaterThanOrEqual(1);
        res.data.inventory_orders.forEach(order => {
          expect(order.order_date.startsWith("2025-02-01")).toBe(true);
        });
      });

      it("should paginate results", async () => {
        const res1 = await api.get("/admin/inventory-orders?limit=2&offset=0", headers);
        expect(res1.status).toBe(200);
        expect(res1.data.inventory_orders.length).toBeLessThanOrEqual(2);
        expect(res1.data.count).toBeGreaterThanOrEqual(3);
        const res2 = await api.get("/admin/inventory-orders?limit=2&offset=2", headers);
        expect(res2.status).toBe(200);
        expect(res2.data.inventory_orders.length).toBeLessThanOrEqual(2);
      });

      it("should order results by order_date desc", async () => {
        const res = await api.get("/admin/inventory-orders?order=order_date:desc", headers);
        expect(res.status).toBe(200);
        const orders = res.data.inventory_orders;
        for (let i = 1; i < orders.length; i++) {
          expect(new Date(orders[i-1].order_date) >= new Date(orders[i].order_date)).toBe(true);
        }
      });

      it("should combine filters (status and quantity)", async () => {
        const res = await api.get("/admin/inventory-orders?status=Processing&quantity=5", headers);
        expect(res.status).toBe(200);
        expect(res.data.inventory_orders.length).toBeGreaterThanOrEqual(1);
        res.data.inventory_orders.forEach(order => {
          expect(order.status).toBe("Processing");
          expect(order.quantity).toBe(5);
        });
      });
    });

    describe("GET /admin/inventory-orders/:id", () => {
      let createdOrder: any;
      let createdOrderId: string;
      beforeEach(async () => {
        // Create an inventory item and an order
        const inventoryRes = await api.post("/admin/inventory-items", {
          title: "Test Inventory Single",
          description: "Test Description Single"
        }, headers);
        expect(inventoryRes.status).toBe(200);
        const inventoryItemId = inventoryRes.data.inventory_item.id;
        const stockLocations = {
          name: 'Main Warehouse'
        }
        const stockLocation = await api.post("/admin/stock-locations", stockLocations, headers);
        expect(stockLocation.status).toBe(200);
        const stockLocationId = stockLocation.data.stock_location.id;
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
          stock_location_id: stockLocationId,
        };
        const res = await api.post("/admin/inventory-orders", orderPayload, headers);
        expect(res.status).toBe(201);
        createdOrder = res.data;
        createdOrderId = res.data.inventoryOrder.id;
      });

      it("should fetch a single inventory order by id", async () => {
        const res = await api.get(`/admin/inventory-orders/${createdOrderId}?fields=id,orderlines.*`, headers);
        expect(res.status).toBe(200);
        expect(res.data.inventoryOrder).toBeDefined();
        expect(res.data.inventoryOrder.id).toBe(createdOrderId);
        expect(res.data.inventoryOrder.orderlines.length).toBe(1);
      });

      it("should fetch a single inventory order with specific fields", async () => {
        const res = await api.get(`/admin/inventory-orders/${createdOrderId}?fields=id,status`, headers);
        expect(res.status).toBe(200);
        expect(res.data.inventoryOrder).toBeDefined();
        expect(res.data.inventoryOrder.id).toBe(createdOrderId);
        expect(res.data.inventoryOrder.status).toBe("Pending");
        // Should not include orderlines if not requested
        expect(res.data.inventoryOrder.orderlines).toBeUndefined();
      });
    });

    describe("PUT /admin/inventory-orders/:id", () => {
      let createdOrder: any;
      let createdOrderId: string;
      beforeEach(async () => {
        // Create an inventory item and an order
        const inventoryRes = await api.post("/admin/inventory-items", {
          title: "Test Inventory Update",
          description: "Test Description Update"
        }, headers);
        expect(inventoryRes.status).toBe(200);
        const inventoryItemId = inventoryRes.data.inventory_item.id;
        const stockLocations = {
          name: 'Main Warehouse'
        }
        const stockLocation = await api.post("/admin/stock-locations", stockLocations, headers);
        expect(stockLocation.status).toBe(200);
        const stockLocationId = stockLocation.data.stock_location.id;
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
          stock_location_id: stockLocationId,
        };
        const res = await api.post("/admin/inventory-orders", orderPayload, headers);
        expect(res.status).toBe(201);
        createdOrder = res.data;
        createdOrderId = res.data.inventoryOrder.id;
      });

      it("should update an inventory order when status is Pending", async () => {
        const updatePayload = {
          status: "Pending",
          quantity: 5,
          total_price: 500,
        };
        const res = await api.put(`/admin/inventory-orders/${createdOrderId}`, updatePayload, headers);
        expect(res.status).toBe(200);
        expect(res.data.quantity).toBe(5);
        expect(res.data.total_price).toBe(500);
      });

      it("should not update an order if status is not Pending", async () => {
        // First, update status to Processing
        const updateStatus = { status: "Processing" };
        const res1 = await api.put(`/admin/inventory-orders/${createdOrderId}`, updateStatus, headers);
        expect(res1.status).toBe(200);
        // Now, try to update again (should fail)
        const updatePayload = { quantity: 10 };
        const res2 = await api.put(`/admin/inventory-orders/${createdOrderId}`, updatePayload, headers).catch((err) => err.response);
        expect(res2.status).toBe(400);
        expect(res2.data.message).toBe("Order can only be updated if status is 'Pending'.");
      });

      it("should return 400 for invalid update payload", async () => {
        const updatePayload = {
          quantity: -3,
        };
        const res = await api.put(`/admin/inventory-orders/${createdOrderId}`, updatePayload, headers).catch((err) => err.response);
        expect(res.status).toBe(400);
        expect(res.data.message).toBe('too_small Order quantity must be a positive integer (at path: quantity)');
      });


    });
  },
});
