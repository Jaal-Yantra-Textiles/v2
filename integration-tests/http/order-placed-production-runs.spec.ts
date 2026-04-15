import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import orderPlacedHandler from "../../src/subscribers/order-placed"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("order.placed subscriber → production runs", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      // Create email templates used by workflows (ignore if already exists)
      const emailTemplates = [
        {
          name: "Admin Partner Created",
          template_key: "partner-created-from-admin",
          subject: "You're invited to set up your partner account at {{partner_name}}",
          html_content: `<div>Partner {{partner_name}} created. Temp password: {{temp_password}}</div>`,
          from: "partners@jaalyantra.com",
          variables: {
            partner_name: "Partner display name",
            temp_password: "Temporary password issued to the partner admin",
          },
          template_type: "email",
        },
        {
          name: "Design Production Started",
          template_key: "design-production-started",
          subject: "Production started for {{design_name}}",
          html_content: "<div>Production for {{design_name}} has started.</div>",
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
        {
          name: "Design Production Completed",
          template_key: "design-production-completed",
          subject: "Production completed for {{design_name}}",
          html_content: "<div>Production for {{design_name}} is complete.</div>",
          from: "designs@jaalyantra.com",
          variables: { design_name: "name" },
          template_type: "email",
        },
      ]
      for (const tpl of emailTemplates) {
        try {
          await api.post("/admin/email-templates", tpl, adminHeaders)
        } catch (e: any) {
          // ok
        }
      }
    })

    it("should create ProductionRuns per order line item with linked product→design and be idempotent", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()

      const unique = Date.now()

      // Create a design
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `OrderPlaced Design ${unique}`,
          description: "Design for order placed subscriber test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // Create product A (linked to design)
      const productARes = await api.post(
        "/admin/products",
        {
          title: `OrderPlaced Product A ${unique}`,
          description: "Product linked to design",
          status: "published",
          handle: `orderplaced-prod-a-${unique}`,
          options: [{ title: "Default", values: ["Default"] }],
        },
        adminHeaders
      )
      expect(productARes.status).toBe(200)
      const productAId = productARes.data.product.id

      const linkRes = await api.post(
        `/admin/products/${productAId}/linkDesign`,
        { designId },
        adminHeaders
      )
      expect(linkRes.status).toBe(200)

      // Create product B (not linked)
      const productBRes = await api.post(
        "/admin/products",
        {
          title: `OrderPlaced Product B ${unique}`,
          description: "Product not linked to design",
          status: "published",
          handle: `orderplaced-prod-b-${unique}`,
          options: [{ title: "Default", values: ["Default"] }],
        },
        adminHeaders
      )
      expect(productBRes.status).toBe(200)
      const productBId = productBRes.data.product.id

      // Create an order directly in the Order module.
      // We only need the order+items for the subscriber.
      const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
      const createdOrder: any = await orderService.createOrders({
        currency_code: "usd",
        email: `orderplaced-${unique}@jyt.test`,
        items: [
          {
            title: "Line A",
            quantity: 2,
            unit_price: 1000,
            product_id: productAId,
          },
          {
            title: "Line B",
            quantity: 1,
            unit_price: 500,
            product_id: productBId,
          },
        ],
      } as any)

      expect(createdOrder?.id).toBeDefined()

      // Trigger subscriber handler (like event bus would)
      await orderPlacedHandler({
        event: { data: { id: createdOrder.id } },
        container,
      } as any)

      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
      const { data: runsAfter } = await query.graph({
        entity: "production_runs",
        fields: [
          "id",
          "design_id",
          "order_id",
          "order_line_item_id",
          "product_id",
          "variant_id",
          "quantity",
          "status",
        ],
        filters: { order_id: createdOrder.id },
      })

      const runs = runsAfter || []
      // Only the linked product should create a run
      expect(runs.length).toBe(1)

      const run = runs[0]
      expect(run.design_id).toBe(designId)
      expect(run.order_id).toBe(createdOrder.id)
      expect(run.product_id).toBe(productAId)
      expect(run.status).toBe("pending_review")

      // Idempotency: trigger again should not create duplicates
      await orderPlacedHandler({
        event: { data: { id: createdOrder.id } },
        container,
      } as any)

      const { data: runsAfter2 } = await query.graph({
        entity: "production_runs",
        fields: ["id"],
        filters: { order_id: createdOrder.id },
      })

      expect((runsAfter2 || []).length).toBe(1)
    })
  })
})
