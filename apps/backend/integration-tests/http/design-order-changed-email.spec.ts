import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"
import { createOrderWorkflow } from "@medusajs/medusa/core-flows"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { emailTemplatesData } from "../../src/scripts/seed-email-templates"
import { linkDesignsToOrderItems } from "../../src/workflows/designs/link-designs-to-order-items"
import designOrderLineItemLink from "../../src/links/design-order-line-item-link"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

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

    const listEmails = async (to: string) => {
      const notificationService: any = getContainer().resolve(
        Modules.NOTIFICATION
      )
      const rows = await notificationService.listNotifications({ to })
      return (rows || []).filter(
        (n: any) => n.template === "design-order-changed"
      )
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

    /**
     * 🔴 The behaviour this batch route exists for.
     *
     * Three lines re-pointed one call at a time sent the customer THREE emails
     * about one decision, each describing a third of it. Medusa's own order
     * edit accumulates actions on a single change and emits exactly one event
     * when it is applied, however many lines moved — this does the same.
     */
    it("sends ONE email for a change covering three lines", async () => {
      const container = getContainer()
      const stamp = Date.now()
      const email = `batch-change-${stamp}@jyt.test`

      const originals = [
        await makeDesign(`Batch O1 ${stamp}`),
        await makeDesign(`Batch O2 ${stamp}`),
        await makeDesign(`Batch O3 ${stamp}`),
      ]
      const replacements = [
        await makeDesign(`Batch N1 ${stamp}`),
        await makeDesign(`Batch N2 ${stamp}`),
      ]

      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          is_draft_order: true,
          status: "draft",
          no_notification: true,
          email,
          region_id: regionId,
          currency_code: "inr",
          items: originals.map((design_id, i) => ({
            title: `Piece ${i + 1}`,
            quantity: 1,
            unit_price: 100,
            metadata: { design_id },
          })) as any,
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

      const byTitle = (t: string) =>
        order.items.find((i: any) => i.title === t).id as string

      const changes = [
        { line_item_id: byTitle("Piece 1"), design_id: replacements[0] },
        { line_item_id: byTitle("Piece 2"), design_id: replacements[1] },
        // ...and a detach in the same change.
        { line_item_id: byTitle("Piece 3"), design_id: null },
      ]

      // Preview first: the notice comes back built, and NOTHING is sent.
      const preview = await api.post(
        `/admin/orders/${order.id}/design-changes`,
        { changes, dry_run: true },
        adminHeaders
      )
      expect(preview.status).toBe(200)
      expect(preview.data.items).toHaveLength(3)
      expect(preview.data.notice.changed_lines).toHaveLength(3)
      expect(preview.data.email.sent).toBe(false)
      expect(await listEmails(email)).toHaveLength(0)

      const res = await api.post(
        `/admin/orders/${order.id}/design-changes`,
        { changes },
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.order_id).toBe(order.id)
      expect(res.data.items.map((i: any) => i.action)).toEqual([
        "replaced",
        "replaced",
        "detached",
      ])
      expect(res.data.email.sent).toBe(true)

      // ONE email, carrying all three lines.
      let rows = await listEmails(email)
      for (let i = 0; i < 20 && rows.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 200))
        rows = await listEmails(email)
      }
      expect(rows).toHaveLength(1)

      const html = rows[0].data._template_html_content as string
      expect(rows[0].data._template_processed).toBe(true)
      expect(html).toContain(`Batch N1 ${stamp}`)
      expect(html).toContain(`Batch N2 ${stamp}`)
      // The detached line says so, rather than naming a design it no longer has.
      expect(html).toContain(`No longer includes Batch O3 ${stamp}`)
      // The headline speaks about the whole order, not one garment.
      expect(rows[0].data.headline).toContain("designs")
    })

    /**
     * 🔴 The claim that reached a real customer.
     *
     * Order #3's items carry a null `variant_id` (#1918), so no run was ever
     * stamped with their `order_line_item_id` — while each of their designs had
     * TWO completed runs. The line-only lookup reported "not started yet", and
     * that sentence was emailed to Aline about garments that had been finished.
     */
    it("does not claim 'not started' when the design has runs the LINE does not", async () => {
      const container = getContainer()
      const stamp = Date.now()
      const designA = await makeDesign(`Run State A ${stamp}`)
      const designB = await makeDesign(`Run State B ${stamp}`)

      const { result: order }: any = await createOrderWorkflow(container).run({
        input: {
          is_draft_order: true,
          status: "draft",
          no_notification: true,
          email: `run-state-${stamp}@jyt.test`,
          region_id: regionId,
          currency_code: "inr",
          items: [
            {
              title: "Made, but not against this line",
              quantity: 1,
              unit_price: 100,
              metadata: { design_id: designA },
            },
          ] as any,
        } as any,
      })
      await linkDesignsToOrderItems(container, order.id)

      // A COMPLETED run for the design, carrying no order_line_item_id —
      // exactly the shape prod is in.
      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
      await runService.createProductionRuns({
        design_id: designA,
        status: "completed",
        quantity: 1,
        // Required by the model; the run's content is irrelevant here — only
        // that a run for this DESIGN exists while carrying no line id.
        snapshot: {},
        captured_at: new Date(),
      })

      const preview = await api.post(
        `/admin/designs/orders/${order.items[0].id}/design`,
        { design_id: designB, dry_run: true },
        adminHeaders
      )
      expect(preview.status).toBe(200)

      const line = preview.data.notice.lines[0]
      // Not "not_started": we have no record for this LINE, and saying nothing
      // was begun about a finished garment is the lie this prevents.
      expect(line.production_state).toBe("unknown")
      expect(line.production_label).not.toMatch(/not started/i)
      // And not "made" either — a run for the design is not proof it was made
      // for THIS order.
      expect(line.production_label).not.toMatch(/already made/i)
      expect(line.reassuring).toBe(false)
      expect(preview.data.notice.any_not_started).toBe(false)
      expect(preview.data.notice.any_unknown).toBe(true)
    })

    it("refuses a change whose lines belong to another order — before writing", async () => {
      const container = getContainer()
      const stamp = Date.now()
      const designA = await makeDesign(`Guard A ${stamp}`)
      const designB = await makeDesign(`Guard B ${stamp}`)

      const make = async () => {
        const { result: o }: any = await createOrderWorkflow(container).run({
          input: {
            is_draft_order: true,
            status: "draft",
            no_notification: true,
            email: `guard-${stamp}@jyt.test`,
            region_id: regionId,
            currency_code: "inr",
            items: [
              {
                title: "Guarded piece",
                quantity: 1,
                unit_price: 100,
                metadata: { design_id: designA },
              },
            ] as any,
          } as any,
        })
        await linkDesignsToOrderItems(container, o.id)
        return o
      }

      const one = await make()
      const two = await make()

      const res = await api
        .post(
          `/admin/orders/${two.id}/design-changes`,
          {
            changes: [
              { line_item_id: one.items[0].id, design_id: designB },
            ],
          },
          adminHeaders
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)

      // 🔴 And nothing moved: the guard runs before the write, so the line is
      // still on the design it was ordered as.
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: rows } = await query.graph({
        entity: designOrderLineItemLink.entryPoint,
        fields: ["design_id", "order_line_item_id"],
        filters: { order_line_item_id: one.items[0].id },
      })
      expect(rows.map((r: any) => r.design_id)).toEqual([designA])
    })
  })
})
