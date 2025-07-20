import { Modules } from "@medusajs/framework/utils"
import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_EMAIL = "partner@error-cases-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(30000)

medusaIntegrationTestRunner({
  testSuite: ({ dbConnection, getContainer, api }) => {
    describe("Send to Partner - Error Cases", () => {
      let appContainer
      let inventoryItemId
      let stockLocationId
      let partnerId
      let inventoryOrderId
      let adminHeaders
      let partnerHeaders

      beforeEach(async () => {
        appContainer = getContainer()
        
        // Create admin user and get headers for admin operations
        await createAdminUser(appContainer)
        adminHeaders = await getAuthHeaders(api)

        // Register and login partner admin (this will be the partner admin)
        await api.post("/auth/partner/emailpass/register", {
          email: TEST_PARTNER_EMAIL,
          password: TEST_PARTNER_PASSWORD,
        })

        const partnerLoginResponse = await api.post("/auth/partner/emailpass", {
          email: TEST_PARTNER_EMAIL,
          password: TEST_PARTNER_PASSWORD,
        })

        partnerHeaders = {
          Authorization: `Bearer ${partnerLoginResponse.data.token}`,
        }

        // Create partner
        const partnerPayload = {
          name: "Test Error Cases Partner",
          handle: "test-error-cases-partner",
          admin: {
            email: TEST_PARTNER_EMAIL,
            first_name: "Partner",
            last_name: "Admin",
          },
        }

        const partnerResponse = await api.post("/partners", partnerPayload, { headers: partnerHeaders })
        partnerId = partnerResponse.data.partner.id

        // Get fresh token after partner creation (critical for auth context)
        const newAuthResponse = await api.post("/auth/partner/emailpass", {
          email: TEST_PARTNER_EMAIL,
          password: TEST_PARTNER_PASSWORD,
        })
        partnerHeaders = {
          Authorization: `Bearer ${newAuthResponse.data.token}`,
        }

        // Create inventory item
        const inventoryPayload = {
          title: "Error Test Fabric",
          description: "Fabric for error testing",
        }
        const inventoryResponse = await api.post("/admin/inventory-items", inventoryPayload, adminHeaders)
        expect(inventoryResponse.status).toBe(200)
        inventoryItemId = inventoryResponse.data.inventory_item.id

        // Create stock location
        const stockLocationPayload = {
          name: "Error Test Warehouse",
        }
        const stockLocationResponse = await api.post("/admin/stock-locations", stockLocationPayload, adminHeaders)
        expect(stockLocationResponse.status).toBe(200)
        stockLocationId = stockLocationResponse.data.stock_location.id

        // Create inventory order for error tests
        const orderPayload = {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 50, price: 15.00 },
          ],
          quantity: 50,
          total_price: 750,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          order_date: new Date().toISOString(),
          shipping_address: {
            address_1: "123 Error St",
            city: "Error Test City",
            postal_code: "12345",
            country_code: "US"
          },
          stock_location_id: stockLocationId,
          is_sample: false,
        }

        const orderResponse = await api.post("/admin/inventory-orders", orderPayload, adminHeaders)
        expect(orderResponse.status).toBe(201)
        inventoryOrderId = orderResponse.data.inventoryOrder.id
      })

      describe("Admin Send to Partner - Error Cases", () => {
        it("should fail to send non-existent order to partner", async () => {
          const sendToPartnerPayload = {
            partnerId: partnerId,
            notes: "Test notes"
          }

          const response = await api.post(
            `/admin/inventory-orders/non-existent-id/send-to-partner`,
            sendToPartnerPayload,
            adminHeaders
          ).catch((err) => err.response)

          expect(response.status).toBe(404)
          expect(response.data.message).toBe("Inventory order non-existent-id not found")
        })

        it("should fail to send order to non-existent partner", async () => {
          const sendToPartnerPayload = {
            partnerId: "non-existent-partner-id",
            notes: "Test notes"
          }

          const response = await api.post(
            `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
            sendToPartnerPayload,
            adminHeaders
          ).catch((err) => err.response)

          expect(response.status).toBe(404)
          expect(response.data.message).toBe("Partner non-existent-partner-id not found")
        })

        it("should fail with missing partnerId", async () => {
          const sendToPartnerPayload = {
            notes: "Test notes"
          }

          const response = await api.post(
            `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
            sendToPartnerPayload,
            adminHeaders
          ).catch((err) => err.response)

          expect(response.status).toBe(400)
          expect(response.data.message).toContain("partnerId")
        })
      })

      describe("Partner View Orders - Error Cases", () => {
        it("should fail to view non-existent order", async () => {
          const response = await api.get(`/partners/inventory-orders/non-existent-id`, {
            headers: partnerHeaders
          }).catch((err) => err.response)
          
          expect(response.status).toBe(404)
          expect(response.data.message).toBe("Inventory order non-existent-id not found")
        })

        it("should fail to view unassigned order", async () => {
          // Create another order that's not assigned to this partner
          const unassignedOrderPayload = {
            order_lines: [
              { inventory_item_id: inventoryItemId, quantity: 25, price: 12.00 },
            ],
            quantity: 25,
            total_price: 300,
            status: "Pending",
            expected_delivery_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: {
              address_1: "123 Unassigned St",
              city: "Unassigned City",
              postal_code: "12345",
              country_code: "US"
            },
            stock_location_id: stockLocationId,
            is_sample: false,
          }

          const unassignedOrderResponse = await api.post("/admin/inventory-orders", unassignedOrderPayload, adminHeaders)
          const unassignedOrderId = unassignedOrderResponse.data.inventoryOrder.id

          const response = await api.get(`/partners/inventory-orders/${unassignedOrderId}`, {
            headers: partnerHeaders
          }).catch((err) => err.response)

          expect(response.status).toBe(400)
          expect(response.data.message).toBe(`Inventory order ${unassignedOrderId} is not assigned to your partner account`)
        })

        it("should fail without partner authentication", async () => {
          const response = await api.get(`/partners/inventory-orders/${inventoryOrderId}`).catch((err) => err.response)

          expect(response.status).toBe(401)
        })
      })

      describe("Partner Start Order - Error Cases", () => {
        it("should fail to start non-existent order", async () => {
          const response = await api.post(`/partners/inventory-orders/non-existent-id/start`, {}, {
            headers: partnerHeaders
          }).catch((err) => err.response)

          expect(response.status).toBe(404)
          expect(response.data.message).toBe("InventoryOrders with id: non-existent-id was not found")
        })

        it("should fail to start unassigned order", async () => {
          // Create separate order that's not assigned to partner
          const separateOrderPayload = {
            order_lines: [
              { inventory_item_id: inventoryItemId, quantity: 30, price: 15.00 },
            ],
            quantity: 30,
            total_price: 450,
            status: "Pending",
            expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: {
              address_1: "123 Separate St",
              city: "Separate City",
              postal_code: "12345",
              country_code: "US"
            },
            stock_location_id: stockLocationId,
            is_sample: false,
          }

          const separateOrderResponse = await api.post("/admin/inventory-orders", separateOrderPayload, adminHeaders)
          const separateOrderId = separateOrderResponse.data.inventoryOrder.id

          const response = await api.post(`/partners/inventory-orders/${separateOrderId}/start`, {}, {
            headers: partnerHeaders
          }).catch((err) => err.response)

          expect(response.status).toBe(400)
          expect(response.data.error).toBe("Order is not assigned to a partner workflow")
        })
      })

      describe("Partner Complete Order - Error Cases", () => {
        it("should fail to complete non-existent order", async () => {
          const response = await api.post(`/partners/inventory-orders/non-existent-id/complete`, {
            notes: "Test completion"
          }, {
            headers: partnerHeaders
          }).catch((err) => err.response)

          expect(response.status).toBe(404)
          expect(response.data.message).toBe("InventoryOrders with id: non-existent-id was not found")
        })

        it("should fail to complete unassigned order", async () => {
          // Create separate order that's not assigned to partner
          const separateOrderPayload = {
            inventory_item_id: inventoryItemId,
            quantity: 40,
            status: "Pending",
            expected_delivery_date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
            order_date: new Date().toISOString(),
            shipping_address: {
              city: "Complete Test City",
              address_1: "456 Complete St",
              postal_code: "54321",
              country_code: "US"
            },
            stock_location_id: stockLocationId,
            is_sample: false,
            total_price: 100,
            order_lines: [
              { inventory_item_id: inventoryItemId, quantity: 40, price: 2.50 },
            ],
          }

          const separateOrderResponse = await api.post("/admin/inventory-orders", separateOrderPayload, adminHeaders)
          const separateOrderId = separateOrderResponse.data.inventoryOrder.id

          const response = await api.post(`/partners/inventory-orders/${separateOrderId}/complete`, {
            notes: "Test completion"
          }, {
            headers: partnerHeaders
          }).catch((err) => err.response)

          expect(response.status).toBe(400)
          expect(response.data.message).toBe(`Inventory order ${separateOrderId} is not in Processing state`)
        })
      })

      describe("Partner List Orders - Error Cases", () => {
        it("should fail without partner authentication", async () => {
          const response = await api.get(`/partners/inventory-orders`).catch((err) => err.response)

          expect(response.status).toBe(401)
        })

        it("should return empty list for partner with no assigned orders", async () => {
          const response = await api.get(`/partners/inventory-orders`, {
            headers: partnerHeaders
          })

          console.log(response.data)

          expect(response.status).toBe(200)
          expect(response.data.inventory_orders).toEqual([])
          expect(response.data.count).toBe(0)
        })
      })
    })
  }
})
