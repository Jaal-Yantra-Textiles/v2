import { Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { emailTemplatesData } from "../../src/scripts/seed-email-templates"
import { linkDesignsToOrderItems } from "../../src/workflows/designs/link-designs-to-order-items"

jest.setTimeout(120 * 1000)

/**
 * The design-change email the customer actually receives (#1918).
 *
 * 🔴 The re-point path sent `createNotifications` a template KEY and no
 * rendered HTML. The provider needs `_template_html_content`; without it it
 * falls back to a generic "Notification from Jaal Yantra Textiles" shell and
 * reports success — so `email.sent` was true, a notification row existed, and
 * the customer never received the sentence the admin was shown in the confirm
 * dialog. There was no `design-order-changed` template in the seed at all.
 *
 * This asserts the RENDER, not the send. A send is not evidence of an email.
 */
setupSharedTestSuite(() => {
  describe("#1918 — design-order-changed email renders its own template", () => {
    let adminHeaders: { headers: Record<string, string> }
    let regionId: string

    const { api, getContainer } = getSharedTestEnv()

    const makeDesign = async (name: string): Promise<string> => {
      const res = await api.post(
        "/admin/designs",
        {
          name,
          description: "design-change email spec",
          design_type: "Original",
          status: "Approved",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    const seedTemplate = async () => {
      const svc: any = getContainer().resolve(EMAIL_TEMPLATES_MODULE)
      const data = emailTemplatesData.find(
        (t: any) => t.template_key === "design-order-changed"
      )!
      expect(data).toBeDefined()
      const [existing] = await svc.listEmailTemplates({
        template_key: "design-order-changed",
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

    const findEmail = async (to: string) => {
      const notificationService: any = getContainer().resolve(
        Modules.NOTIFICATION
      )
      let found: any
      for (let i = 0; i < 25 && !found; i++) {
        const rows = await notificationService.listNotifications({ to })
        found = (rows || []).find(
          (n: any) => n.template === "design-order-changed"
        )
        if (!found) await new Promise((r) => setTimeout(r, 200))
      }
      return found
    }

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      await seedTemplate()

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Design Change Email Region",
          currency_code: "inr",
          countries: ["in"],
        })
        regionId = region.id
      }
    })

    it("sends the rendered design-order-changed template on a re-point", async () => {
      const container = getContainer()
      const stamp = Date.now()
      const email = `design-change-${stamp}@jyt.test`

      const designA = await makeDesign(`Email A ${stamp}`)
      const designB = await makeDesign(`Email B ${stamp}`)

      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          is_draft_order: true,
          status: "draft",
          no_notification: true,
          email,
          region_id: regionId,
          currency_code: "inr",
          items: [
            {
              title: "Commissioned piece",
              quantity: 1,
              unit_price: 100,
              metadata: { design_id: designA },
            },
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
      await linkDesignsToOrderItems(container, order.id)

      const res = await api.post(
        `/admin/designs/orders/${order.items[0].id}/design`,
        { design_id: designB },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.action).toBe("replaced")
      expect(res.data.email.sent).toBe(true)

      const notification = await findEmail(email)
      expect(notification).toBeDefined()

      const data = notification.data as any
      // 🔴 The assertion the old code failed: it sent with no rendered
      // template, and the provider quietly substituted a generic shell.
      expect(data._template_processed).toBe(true)
      expect(data._template_subject).toContain(String(order.display_id))
      expect(data._template_html_content).toContain("A change to your order")
      expect(data._template_html_content).toContain("Hi Aline,")
      // The change itself, in the body — both design names, from the notice.
      expect(data._template_html_content).toContain(`Email A ${stamp}`)
      expect(data._template_html_content).toContain(`Email B ${stamp}`)
    })
  })
})
