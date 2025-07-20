import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_EMAIL = "partner@complete-workflow-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60000)

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    describe("Send to Partner - Complete Workflow", () => {
      let adminHeaders: any
      let partnerHeaders: any
      let inventoryItemId: string
      let stockLocationId: string
      let inventoryOrderId: string
      let partnerId: string

      beforeEach(async () => {
        const container = getContainer()
        
        // Create admin user and get headers for admin operations
        await createAdminUser(container)
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

        // Create a partner using the partner admin's authentication
        // This links the partner to the authenticated partner admin
        const partnerPayload = {
          name: "Test Manufacturing Partner",
          handle: "test-complete-workflow-partner",
          admin: {
            email: TEST_PARTNER_EMAIL,
            first_name: "Partner",
            last_name: "Admin",
          },
        }

        const partnerResponse = await api.post("/partners", partnerPayload, {
          headers: partnerHeaders,
        })
        expect(partnerResponse.status).toBe(200)
        partnerId = partnerResponse.data.partner.id

        // Get fresh token after partner creation (following partner-people-api.spec.ts pattern)
        const newAuthResponse = await api.post("/auth/partner/emailpass", {
          email: TEST_PARTNER_EMAIL,
          password: TEST_PARTNER_PASSWORD,
        })

        // Update headers with new token
        partnerHeaders = {
          Authorization: `Bearer ${newAuthResponse.data.token}`,
        }

        // Create inventory item
        const inventoryPayload = {
          title: "Test Fabric",
          description: "Premium cotton fabric for testing",
        }
        const inventoryResponse = await api.post("/admin/inventory-items", inventoryPayload, adminHeaders)
        expect(inventoryResponse.status).toBe(200)
        inventoryItemId = inventoryResponse.data.inventory_item.id

        // Create stock location
        const stockLocationPayload = {
          name: "Main Warehouse",
        }
        const stockLocationResponse = await api.post("/admin/stock-locations", stockLocationPayload, adminHeaders)
        expect(stockLocationResponse.status).toBe(200)
        stockLocationId = stockLocationResponse.data.stock_location.id

        // Create inventory order
        const orderPayload = {
          order_lines: [
            { inventory_item_id: inventoryItemId, quantity: 100, price: 25.50 },
          ],
          quantity: 100,
          total_price: 2550,
          status: "Pending",
          expected_delivery_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
          order_date: new Date().toISOString(),
          shipping_address: {
            address_1: "123 Factory St",
            city: "Manufacturing City",
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

      it("should complete full send-to-partner workflow", async () => {
        // 1. Send order to partner (admin)
        console.log("\nSending order to partner...")
        const sendToPartnerPayload = {
          partnerId: partnerId,
          notes: "Complete workflow test order"
        }

        const sendResponse = await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
          sendToPartnerPayload,
          adminHeaders
        )

        expect(sendResponse.status).toBe(200)
        expect(sendResponse.data.message).toBe("Inventory order sent to partner successfully")
        expect(sendResponse.data.inventoryOrderId).toBe(inventoryOrderId)
        expect(sendResponse.data.partnerId).toBe(partnerId)

        // Wait for workflow to initialize
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 2. Start order (partner)
        console.log("\nStarting order as partner...")
        const startResponse = await api.post(`/partners/inventory-orders/${inventoryOrderId}/start`, {}, {
          headers: partnerHeaders
        })

        expect(startResponse.status).toBe(200)
        expect(startResponse.data.message).toBe("Order started successfully")
        expect(startResponse.data.order).toBeDefined()
        expect(startResponse.data.order.metadata.partner_status).toBe("started")
        expect(startResponse.data.order.metadata.partner_started_at).toBeDefined()

        // Wait for workflow step to process
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 3. Complete order (partner)
        console.log("\nCompleting order as partner...")
        const completeResponse = await api.post(`/partners/inventory-orders/${inventoryOrderId}/complete`, {
          notes: "Order completed successfully",
          tracking_number: "TRACK123456"
        }, {
          headers: partnerHeaders
        })
        
        expect(completeResponse.status).toBe(200)
        expect(completeResponse.data.message).toBe("Order completed successfully")
        expect(completeResponse.data.order).toBeDefined()
        expect(completeResponse.data.order.status).toBe("Shipped")
        expect(completeResponse.data.order.metadata.partner_status).toBe("completed")
        expect(completeResponse.data.order.metadata.partner_completed_at).toBeDefined()
        expect(completeResponse.data.order.metadata.partner_completion_notes).toBe("Order completed successfully")
        expect(completeResponse.data.order.metadata.assignment_notes).toBe("Complete workflow test order")

        console.log("\n✅ Complete workflow finished successfully!")
      })
    })
  }
})
