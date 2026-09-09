import { Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { emailTemplatesData } from "../../src/scripts/seed-email-templates"

jest.setTimeout(120 * 1000)

/**
 * Tell the customer when their order edit is APPLIED.
 *
 * Medusa emits `order-edit.confirmed` itself from `confirmOrderEditRequest`.
 * Nothing here listened, so a confirmed edit changed the order in silence
 * while the `order-edit-confirmed` template sat active in the database with no
 * sender.
 *
 * 🔴 An integration test, because the thing under test is the WIRING: whether
 * the event actually reaches a subscriber, whether the template is found, and
 * whether it renders. A unit test can only re-assert the pure decision, which
 * `order-edit-confirmed-email-lib.unit.spec.ts` already does.
 */
setupSharedTestSuite(() => {
  describe("order-edit.confirmed → customer email", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    /** A placed order with one item and a real email to send to. */
    const makeOrder = async (email: string) => {
      const { result: order }: any = await createOrderWorkflow(
        getContainer()
      ).run({
        input: {
          status: "pending",
          email,
          region_id: regionId,
          currency_code: "inr",
          items: [
            { title: "Editable item", quantity: 1, unit_price: 1000 },
          ] as any,
          shipping_address: {
            first_name: "Aline",
            last_name: "Buyer",
            address_1: "1 Test St",
            city: "Mumbai",
            postal_code: "400001",
            country_code: "in",
          },
        } as any,
      })
      return order
    }

    /**
     * The notification module persists a row per send (the local provider is
     * registered for the `email` channel in test), so the row IS the evidence
     * the subscriber fired.
     */
    const findEmail = async (to: string) => {
      const notificationService: any = getContainer().resolve(
        Modules.NOTIFICATION
      )
      let found: any
      for (let i = 0; i < 25 && !found; i++) {
        const rows = await notificationService.listNotifications({ to })
        found = (rows || []).find(
          (n: any) => n.template === "order-edit-confirmed"
        )
        if (!found) await new Promise((r) => setTimeout(r, 200))
      }
      return found
    }

    /**
     * Upsert the REAL `order-edit-confirmed` template so the workflow renders
     * production HTML, not a stub — the shared test database does not run the
     * template seed.
     */
    const seedTemplate = async () => {
      const svc: any = getContainer().resolve(EMAIL_TEMPLATES_MODULE)
      const data = emailTemplatesData.find(
        (t: any) => t.template_key === "order-edit-confirmed"
      )!
      expect(data).toBeDefined()
      const [existing] = await svc.listEmailTemplates({
        template_key: "order-edit-confirmed",
      })
      const payload = {
        name: data.name,
        template_key: data.template_key,
        subject: data.subject,
        html_content: data.html_content,
        from: (data as any).from,
        template_type: (data as any).template_type,
        locale: "en",
        is_active: true,
      }
      if (existing) {
        await svc.updateEmailTemplates({ id: existing.id, ...payload })
      } else {
        await svc.createEmailTemplates(payload)
      }
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      await seedTemplate()
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Order Edit Email Region",
          currency_code: "inr",
          countries: ["in"],
        })
        regionId = region.id
      }
    })

    /** Begin → change a quantity → request → confirm. */
    const editQuantity = async (
      orderId: string,
      itemId: string,
      quantity: number,
      opts?: { noNotification?: boolean }
    ) => {
      const begin = await api.post(
        "/admin/order-edits",
        { order_id: orderId },
        adminHeaders
      )
      expect(begin.status).toBe(200)

      const update = await api.post(
        `/admin/order-edits/${orderId}/items/item/${itemId}`,
        { quantity },
        adminHeaders
      )
      expect(update.status).toBe(200)

      const request = await api.post(
        `/admin/order-edits/${orderId}/request`,
        opts?.noNotification ? { no_notification: true } : {},
        adminHeaders
      )
      expect(request.status).toBe(200)

      const confirm = await api.post(
        `/admin/order-edits/${orderId}/confirm`,
        {},
        adminHeaders
      )
      expect(confirm.status).toBe(200)
      return confirm
    }

    it("sends the rendered order-edit-confirmed template when a quantity changes", async () => {
      const email = `edit-${Date.now()}@jyt.test`
      const order = await makeOrder(email)

      await editQuantity(order.id, order.items[0].id, 3)

      const notification = await findEmail(email)
      expect(notification).toBeDefined()
      expect(notification.channel).toBe("email")

      // 🔴 The template must be RENDERED, not merely named. Without the
      // `_template_*` payload the provider silently falls back to a generic
      // default email, which looks like a successful send.
      const data = notification.data as any
      expect(data._template_processed).toBe(true)
      expect(data._template_subject).toContain(String(order.display_id))
      expect(data._template_html_content).toContain("Edit Confirmed")
      // Flat variables: a nested payload renders as empty strings and says so
      // nowhere. "Hi Aline," is the proof they resolved.
      expect(data._template_html_content).toContain("Hi Aline,")
      expect(data.customer_first_name).toBe("Aline")
      expect(data.items_updated).toBe(1)
    })

    it("stays quiet when the edit was requested with no_notification", async () => {
      const email = `quiet-${Date.now()}@jyt.test`
      const order = await makeOrder(email)

      await editQuantity(order.id, order.items[0].id, 2, {
        noNotification: true,
      })

      const notificationService: any = getContainer().resolve(
        Modules.NOTIFICATION
      )
      // Give the subscriber the same room to run as the sending case, so this
      // is a real silence and not a race we happened to win.
      await new Promise((r) => setTimeout(r, 2000))
      const rows = await notificationService.listNotifications({ to: email })
      expect(
        (rows || []).filter((n: any) => n.template === "order-edit-confirmed")
      ).toHaveLength(0)
    })
  })
})
