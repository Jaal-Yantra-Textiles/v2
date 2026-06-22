import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import { sendOrderCanceledCustomerEmailWorkflow } from "../../src/workflows/email/workflows/send-order-canceled-customer-email"
import { shouldSendCustomerCancellationEmail } from "../../src/workflows/email/workflows/order-canceled-customer-email-lib"

jest.setTimeout(60 * 1000)

/**
 * #576 slice A — customer order-cancellation email.
 * The base/local config has no real email provider, so we assert the workflow
 * compiles + resolves the active `order-canceled` template and runs end-to-end
 * against a real order, plus exercise the pure skip-decision against live data.
 */
setupSharedTestSuite(() => {
  describe("order.canceled → customer email (#576 slice A)", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      // The shared runner truncates between tests, so (re)seed per test.
      await seedCommonEmailTemplates(api, adminHeaders)
    })

    async function createOrder(unique: number, email = `cancel-${unique}@jyt.test`) {
      const container = getSharedTestEnv().getContainer()
      const orderService = container.resolve(
        Modules.ORDER
      ) as IOrderModuleService
      const order: any = await orderService.createOrders({
        currency_code: "usd",
        email,
        items: [{ title: "Line A", quantity: 1, unit_price: 1000 }],
      } as any)
      return order
    }

    it("has the active order-canceled customer template", async () => {
      const { api } = getSharedTestEnv()
      const res = await api.get("/admin/email-templates", adminHeaders)
      const templates =
        res.data.email_templates || res.data.emailTemplates || []
      const tmpl = templates.find((t: any) => t.template_key === "order-canceled")
      expect(tmpl).toBeDefined()
      expect(tmpl.is_active).toBe(true)
    })

    it("runs the customer cancellation workflow against a real order", async () => {
      const container = getSharedTestEnv().getContainer()
      const order = await createOrder(Date.now())

      // Resolves the active `order-canceled` template + dispatches the
      // notification end-to-end. The workflow returns no WorkflowResponse
      // (mirrors sendOrderConfirmationWorkflow), so completing without throwing
      // is the success signal.
      const run = await sendOrderCanceledCustomerEmailWorkflow(container).run({
        input: { orderId: order.id },
      })
      expect(run.errors).toEqual([])
    })

    it("skips the send when the order has no email", () => {
      const decision = shouldSendCustomerCancellationEmail({
        order: { email: null },
      })
      expect(decision.send).toBe(false)
    })

    it("skips the send when no_notification is on the event", async () => {
      const order = await createOrder(Date.now() + 1)
      const decision = shouldSendCustomerCancellationEmail({
        order,
        eventNoNotification: true,
      })
      expect(decision.send).toBe(false)
      expect(decision.reason).toMatch(/no_notification/)
    })
  })
})
