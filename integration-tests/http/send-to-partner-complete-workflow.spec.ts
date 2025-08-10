import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const TEST_PARTNER_EMAIL = "partner@complete-workflow-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(70000)

setupSharedTestSuite(() => {
    describe("Send to Partner - Complete Workflow", () => {
      let adminHeaders: any
      let partnerHeaders: any
      let inventoryItemId: string
      let stockLocationId: string
      let fromStockLocationId: string
      let inventoryOrderId: string
      let partnerId: string
      const { api , getContainer } = getSharedTestEnv()
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

        // Create partner task templates required by the send-to-partner workflow
        const partnerOrderSentTemplate = {
          name: "partner-order-sent",  // ✅ Use identifier as name, not display name
          description: "Template for when an order is sent to a partner",
          priority: "medium",
          estimated_duration: 30, // in minutes
          required_fields: {
            "order_id": { type: "string", required: true },
            "partner_id": { type: "string", required: true },
            "notes": { type: "text", required: false }
          },
          eventable: true,
          notifiable: true,
          message_template: "Order {{order_id}} has been sent to partner.",
          metadata: {
            workflow_type: "partner_assignment",  // ✅ Match what partner API expects
            workflow_step: "sent"
          },
          category: "Partner Orders"
        }

        const partnerOrderReceivedTemplate = {
          name: "partner-order-received",  // ✅ Use identifier as name, not display name
          description: "Template for when a partner receives an order",
          priority: "medium",
          estimated_duration: 60, // in minutes
          required_fields: {
            "order_id": { type: "string", required: true },
            "partner_id": { type: "string", required: true }
          },
          eventable: true,
          notifiable: true,
          message_template: "Order {{order_id}} has been received by partner.",
          metadata: {
            workflow_type: "partner_assignment",  // ✅ Match what partner API expects
            workflow_step: "received"
          },
          category: "Partner Orders"
        }

        const partnerOrderShippedTemplate = {
          name: "partner-order-shipped",  // ✅ Use identifier as name, not display name
          description: "Template for when a partner ships an order",
          priority: "high",
          estimated_duration: 90, // in minutes
          required_fields: {
            "order_id": { type: "string", required: true },
            "partner_id": { type: "string", required: true },
            "tracking_number": { type: "string", required: false },
            "delivery_date": { type: "date", required: false }
          },
          eventable: true,
          notifiable: true,
          message_template: "Order {{order_id}} has been shipped by partner.",
          metadata: {
            workflow_type: "partner_assignment",  // ✅ Match what partner API expects
            workflow_step: "shipped"
          },
          category: "Partner Orders"
        }

        const partnerLinePartialTemplate = {
          name: "partner-line-partial",  // ✅ Use identifier as name, not display name
          description: "Template for when a partner receives a partial order",
          priority: "medium",
          estimated_duration: 60, // in minutes
          required_fields: {
            "order_id": { type: "string", required: true },
            "partner_id": { type: "string", required: true },
            "order_line_id": { type: "string", required: true },
            "requested": { type: "number", required: true },
            "delivered": { type: "number", required: true },
            "shortage": { type: "number", required: true }
          },
          eventable: true,
          notifiable: true,
          message_template: "Order {{order_id}} has been received by partner.",
          metadata: {
            workflow_type: "partner_completion",  // ✅ Match what partner API expects
            workflow_step: "partial"
          },
          category: "Partner Orders"
        }

        // Create the task templates - first one creates the category, others use category_id
        const sentTemplateResponse = await api.post("/admin/task-templates", partnerOrderSentTemplate, adminHeaders)
        expect(sentTemplateResponse.status).toBe(201)
        console.log("Created sent template:", JSON.stringify(sentTemplateResponse.data.task_template, null, 2))
        
        // Get the category_id from the first template response
        const categoryId = sentTemplateResponse.data.task_template.category_id

        // Update the remaining templates to use category_id instead of category name
        const receivedTemplateWithCategoryId = {
          ...partnerOrderReceivedTemplate,
          category_id: categoryId
        }
        // Remove category property since we're using category_id
        const { category: _, ...receivedTemplateClean } = receivedTemplateWithCategoryId

        const shippedTemplateWithCategoryId = {
          ...partnerOrderShippedTemplate,
          category_id: categoryId
        }
        // Remove category property since we're using category_id
        const { category: __, ...shippedTemplateClean } = shippedTemplateWithCategoryId
        
        const partnerLinePartialTemplateWithCategoryId = {
          ...partnerLinePartialTemplate,
          category_id: categoryId
        }
        // Remove category property since we're using category_id
        const { category: ___, ...partnerLinePartialTemplateClean } = partnerLinePartialTemplateWithCategoryId
        
        const receivedTemplateResponse = await api.post("/admin/task-templates", receivedTemplateClean, adminHeaders)
        expect(receivedTemplateResponse.status).toBe(201)
        console.log("Created received template:", JSON.stringify(receivedTemplateResponse.data.task_template, null, 2))

        const shippedTemplateResponse = await api.post("/admin/task-templates", shippedTemplateClean, adminHeaders)
        expect(shippedTemplateResponse.status).toBe(201)
        console.log("Created shipped template:", JSON.stringify(shippedTemplateResponse.data.task_template, null, 2))

        const partnerLinePartialTemplateResponse = await api.post("/admin/task-templates", partnerLinePartialTemplateClean, adminHeaders)
        expect(partnerLinePartialTemplateResponse.status).toBe(201)
        console.log("Created partner line partial template:", JSON.stringify(partnerLinePartialTemplateResponse.data.task_template, null, 2))

          // Let's also verify we can find the templates by listing them
        const templatesListResponse = await api.get("/admin/task-templates", adminHeaders)
        console.log("All templates after creation:", JSON.stringify(templatesListResponse.data.task_templates, null, 2))

        // Create inventory item
        const inventoryPayload = {
          title: "Test Fabric",
          description: "Premium cotton fabric for testing",
        }
        const inventoryResponse = await api.post("/admin/inventory-items", inventoryPayload, adminHeaders)
        expect(inventoryResponse.status).toBe(200)
        inventoryItemId = inventoryResponse.data.inventory_item.id

        // Create stock location (To)
        const stockLocationPayload = {
          name: "Main Warehouse",
        }
        const stockLocationResponse = await api.post("/admin/stock-locations", stockLocationPayload, adminHeaders)
        expect(stockLocationResponse.status).toBe(200)
        stockLocationId = stockLocationResponse.data.stock_location.id

        // Create second stock location (From)
        const fromLocationPayload = {
          name: "Supplier Warehouse",
        }
        const fromLocationResponse = await api.post("/admin/stock-locations", fromLocationPayload, adminHeaders)
        expect(fromLocationResponse.status).toBe(200)
        fromStockLocationId = fromLocationResponse.data.stock_location.id

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
          // Explicitly provide both to and from
          stock_location_id: stockLocationId, // to (backward compatible)
          to_stock_location_id: stockLocationId, // explicit to
          from_stock_location_id: fromStockLocationId, // from
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

        // Wait for workflow to initialize and create tasks
        await new Promise(resolve => setTimeout(resolve, 2000))
        
        // Verify that partner workflow tasks were created
        console.log("\nVerifying partner order status...")
        const initialPartnerOrderResponse = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, {
          headers: partnerHeaders
        })
        
        expect(initialPartnerOrderResponse.status).toBe(200)
        expect(initialPartnerOrderResponse.data.inventoryOrder.partner_info.partner_status).toBe("assigned")
        expect(initialPartnerOrderResponse.data.inventoryOrder.partner_info.workflow_tasks_count).toBeGreaterThan(0)
        
        // Admin notes should now be available from inventory order metadata
        expect(initialPartnerOrderResponse.data.inventoryOrder.admin_notes).toBe("Complete workflow test order")

        // 2. Start order (partner)
        console.log("\nStarting order as partner...")
        const startResponse = await api.post(`/partners/inventory-orders/${inventoryOrderId}/start`, {}, {
          headers: partnerHeaders
        })

        expect(startResponse.status).toBe(200)
        expect(startResponse.data.message).toBe("Order started successfully")
        expect(startResponse.data.order).toBeDefined()
        expect(startResponse.data.order.status).toBe("Processing") // Order status should change to Processing
        
        // Verify task-based partner status via partner API
        const partnerOrderResponse = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, {
          headers: partnerHeaders
        })
        expect(partnerOrderResponse.status).toBe(200)
        expect(partnerOrderResponse.data.inventoryOrder.partner_info.partner_status).toBe("in_progress")
        expect(partnerOrderResponse.data.inventoryOrder.partner_info.partner_started_at).toBeDefined()

        // Wait for workflow step to process
        await new Promise(resolve => setTimeout(resolve, 1000))

        // 3. Complete order (partner) - now requires delivered lines
        console.log("\nCompleting order as partner...")
        const partnerOrderForComplete = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, {
          headers: partnerHeaders
        })
        const linesForComplete = (partnerOrderForComplete.data.inventoryOrder.order_lines || []).map((l: any) => ({
          order_line_id: l.id,
          quantity: l.quantity, // deliver full requested quantity
        }))
        const completeResponse = await api.post(`/partners/inventory-orders/${inventoryOrderId}/complete`, {
          notes: "Order completed successfully",
          tracking_number: "TRACK123456",
          lines: linesForComplete,
        }, {
          headers: partnerHeaders
        })
        
        expect(completeResponse.status).toBe(200)
        expect(completeResponse.data.message).toBe("Order completed successfully")
        // New route returns result object from workflow
        expect(completeResponse.data.result).toBeDefined()
        // Fetch order to assert status
        const afterFullComplete = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, { headers: partnerHeaders })
        expect(afterFullComplete.data.inventoryOrder.status).toBe("Shipped")
        
        // Verify task-based partner status via partner API
        const finalPartnerOrderResponse = await api.get(`/partners/inventory-orders/${inventoryOrderId}`, {
          headers: partnerHeaders
        })
        expect(finalPartnerOrderResponse.status).toBe(200)
        expect(finalPartnerOrderResponse.data.inventoryOrder.partner_info.partner_status).toBe("completed")
        expect(finalPartnerOrderResponse.data.inventoryOrder.partner_info.partner_completed_at).toBeDefined()
        expect(finalPartnerOrderResponse.data.inventoryOrder.partner_info.workflow_tasks_count).toBeGreaterThan(0)
        expect(finalPartnerOrderResponse.data.inventoryOrder.admin_notes).toBe("Complete workflow test order")

        // Verify fulfillment entries are written and linked to order via orderlines
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: ordersWithFulfillments } = await query.graph({
          entity: "inventory_orders",
          fields: [
            "id",
            "orderlines.id",
            "orderlines.quantity",
            "orderlines.line_fulfillments.*",
          ],
          filters: { id: inventoryOrderId },
        })
        console.log("ordersWithFulfillments", JSON.stringify(ordersWithFulfillments, null, 2))
        expect(ordersWithFulfillments?.length).toBe(1)
        const orderNode = ordersWithFulfillments[0]
        const fulfillments = (orderNode.orderlines || []).flatMap((l: any) => l.line_fulfillments || [])
        const sumDelta = (fulfillments as any[]).reduce((s: number, f: any) => s + (Number(f.quantity_delta) || 0), 0)
        const sumRequested = (orderNode.orderlines || []).reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0)
        expect(sumDelta).toBe(sumRequested)

        console.log("\n✅ Complete workflow finished successfully!")
      })

      it("should keep order open on partial completion (unfinished order line)", async () => {
        // 1. Send order to partner (admin)
        const sendToPartnerPayload = {
          partnerId: partnerId,
          notes: "Partial completion test order",
        }
        const sendResponse = await api.post(
          `/admin/inventory-orders/${inventoryOrderId}/send-to-partner`,
          sendToPartnerPayload,
          adminHeaders
        )
        expect(sendResponse.status).toBe(200)

        // Wait for workflow to initialize and create tasks
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // 2. Start order (partner)
        const startResponse = await api.post(
          `/partners/inventory-orders/${inventoryOrderId}/start`,
          {},
          { headers: partnerHeaders }
        )
        expect(startResponse.status).toBe(200)
        expect(startResponse.data.order.status).toBe("Processing")
        console.log("[LOG][start] status=", startResponse.status, "order.status=", startResponse.data.order.status)

        // 3. Get order lines to build partial completion payload
        const partnerOrderResponse = await api.get(
          `/partners/inventory-orders/${inventoryOrderId}`,
          { headers: partnerHeaders }
        )
        expect(partnerOrderResponse.status).toBe(200)
        const orderLines = partnerOrderResponse.data.inventoryOrder.order_lines || []
        expect(orderLines.length).toBeGreaterThan(0)
        const firstLineId = orderLines[0].id
        console.log("[LOG][get-before-partial] status=", partnerOrderResponse.status, "inv.status=", partnerOrderResponse.data.inventoryOrder.status, "partner_status=", partnerOrderResponse.data.inventoryOrder.partner_info?.partner_status, "lines=", orderLines.length)

        // 4. Complete order with partial delivered quantity (less than requested)
        const partialCompletePayload = {
          notes: "Delivered half due to shortage",
          deliveryDate: new Date().toISOString(),
          trackingNumber: "TRACK-PARTIAL-001",
          lines: [
            {
              order_line_id: firstLineId,
              quantity: Math.max(1, Math.floor((orderLines[0].quantity || 2) / 2)),
            },
          ],
        }
        const completeResponse = await api.post(
          `/partners/inventory-orders/${inventoryOrderId}/complete`,
          partialCompletePayload,
          { headers: partnerHeaders }
        )
        expect(completeResponse.status).toBe(200)
        expect(completeResponse.data.message).toBe("Order updated (partial delivery)")
        expect(completeResponse.data.result.fullyFulfilled).toBe(false)
        console.log("[LOG][complete-partial] status=", completeResponse.status, "result=", completeResponse.data.result)

        // 5. Verify order remains Processing and partner status is still in_progress
        const afterCompletePartnerOrder = await api.get(
          `/partners/inventory-orders/${inventoryOrderId}`,
          { headers: partnerHeaders }
        )
        expect(afterCompletePartnerOrder.status).toBe(200)
        expect(afterCompletePartnerOrder.data.inventoryOrder.status).toBe("Partial")
        // Partner status remains in_progress after a partial completion
        expect(afterCompletePartnerOrder.data.inventoryOrder.partner_info.partner_status).toBe("in_progress")
        console.log("[LOG][get-after-partial] inv.status=", afterCompletePartnerOrder.data.inventoryOrder.status, "partner_status=", afterCompletePartnerOrder.data.inventoryOrder.partner_info?.partner_status)

        // Verify fulfillment entries for partial delivery are recorded and linked via orderlines
        const container = getContainer()
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data: partialOrderWithFulfillments } = await query.graph({
          entity: "inventory_orders",
          fields: [
            "id",
            "orderlines.id",
            "orderlines.quantity",
            "orderlines.line_fulfillments.*",
          ],
          filters: { id: inventoryOrderId },
        })

        expect(partialOrderWithFulfillments?.length).toBe(1)
        const partialOrder = partialOrderWithFulfillments[0]
        const fulfillmentsPartial = (partialOrder.orderlines || []).flatMap((l: any) => l.line_fulfillments || [])
        const deliveredQty = partialCompletePayload.lines[0].quantity
        const totalDelta = (fulfillmentsPartial as any[]).reduce((s: number, f: any) => s + (Number(f.quantity_delta) || 0), 0)
        expect(totalDelta).toBe(deliveredQty)
        console.log("[LOG][verify-partial] fulfillmentsPartial=", fulfillmentsPartial.length, "totalDelta=", totalDelta, "deliveredQty=", deliveredQty)

        // 6. Finalize the order by delivering the remaining quantities for ALL lines
        // Get current order lines with their fulfillments to compute remaining per line
        const { data: finalPrep } = await query.graph({
          entity: "inventory_orders",
          fields: [
            "id",
            "orderlines.id",
            "orderlines.quantity",
            "orderlines.line_fulfillments.*",
          ],
          filters: { id: inventoryOrderId },
        })
        expect(finalPrep?.length).toBe(1)
        const nodeForRemaining = finalPrep[0]
        const ols = (nodeForRemaining.orderlines || []) as any[]

        const remainingLines = ols.map((l: any) => {
          const deliveredSoFar = (l.line_fulfillments || []).reduce((s: number, f: any) => s + (Number(f.quantity_delta) || 0), 0)
          const req = Number(l.quantity || 0)
          const rem = Math.max(0, req - deliveredSoFar)
          return { order_line_id: l.id, remaining: rem, requested: req }
        }).filter((x) => x.remaining > 0)

        // Ensure there is something to deliver to complete the order
        expect(remainingLines.length).toBeGreaterThan(0)
        console.log("[LOG][final-prep] remainingLines=", remainingLines)

        const finalCompletePayload = {
          notes: "Deliver remaining to complete order",
          deliveryDate: new Date().toISOString(),
          trackingNumber: "TRACK-FINAL-001",
          lines: remainingLines.map((x) => ({ order_line_id: x.order_line_id, quantity: x.remaining })),
        }
        const finalCompleteResponse = await api.post(
          `/partners/inventory-orders/${inventoryOrderId}/complete`,
          finalCompletePayload,
          { headers: partnerHeaders }
        )
        expect(finalCompleteResponse.status).toBe(200)
        console.log("[LOG][complete-final] status=", finalCompleteResponse.status, "result=", finalCompleteResponse.data?.result)
        // Give the system a brief moment to persist and propagate state before polling
        await new Promise((r) => setTimeout(r, 300))

        // 7. Verify order partner status is completed and fulfillments sum equals requested
        // Poll since workflow signaling is async
        let finalPartnerOrder: any
        for (let i = 0; i < 30; i++) {
          finalPartnerOrder = await api.get(
            `/partners/inventory-orders/${inventoryOrderId}`,
            { headers: partnerHeaders }
          )
          if (finalPartnerOrder.data.inventoryOrder.partner_info.partner_status === "completed") break
          // Yield to allow async workflow signaling to progress
          await new Promise((r) => setTimeout(r, 200))
        }
        expect(finalPartnerOrder.status).toBe(200)
        // Partner status is derived from workflow tasks; it may still be in_progress shortly after completion
        expect(finalPartnerOrder.data.inventoryOrder.partner_info.partner_status).toBe("completed")
        console.log("[LOG][get-after-final] partner_status=", finalPartnerOrder.data.inventoryOrder?.partner_info?.partner_status, "inv.status=", finalPartnerOrder.data.inventoryOrder?.status)

        const { data: finalOrderWithFulfillments } = await query.graph({
          entity: "inventory_orders",
          fields: [
            "id",
            "orderlines.id",
            "orderlines.quantity",
            "orderlines.line_fulfillments.*",
          ],
          filters: { id: inventoryOrderId },
        })
        expect(finalOrderWithFulfillments?.length).toBe(1)
        const finalNode = finalOrderWithFulfillments[0]
        const fulfillmentsAll = (finalNode.orderlines || []).flatMap((l: any) => l.line_fulfillments || [])
        const finalSumDelta = (fulfillmentsAll as any[]).reduce((s: number, f: any) => s + (Number(f.quantity_delta) || 0), 0)
        const sumRequestedAll = (finalNode.orderlines || []).reduce((s: number, l: any) => s + (Number(l.quantity) || 0), 0)
        expect(finalSumDelta).toBe(sumRequestedAll)
        console.log("[LOG][verify-final] finalSumDelta=", finalSumDelta, "sumRequestedAll=", sumRequestedAll, "fulfillmentsAll=", fulfillmentsAll.length)
      })
    })
})
