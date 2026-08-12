import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  describe("Admin Designs → multi-partner production runs", () => {
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

    it("should create parent run + child runs from assignments", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

      const unique = Date.now()

      // Create 2 partners
      const partner1Res = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `MP Partner 1 ${unique}`,
            handle: `mp-partner-1-${unique}`,
          },
          admin: {
            email: `mp-partner-1-admin-${unique}@jyt.test`,
            first_name: "MP",
            last_name: "One",
          },
        },
        adminHeaders
      )
      expect(partner1Res.status).toBe(201)
      const partner1Id = partner1Res.data.partner.id

      const partner2Res = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `MP Partner 2 ${unique}`,
            handle: `mp-partner-2-${unique}`,
          },
          admin: {
            email: `mp-partner-2-admin-${unique}@jyt.test`,
            first_name: "MP",
            last_name: "Two",
          },
        },
        adminHeaders
      )
      expect(partner2Res.status).toBe(201)
      const partner2Id = partner2Res.data.partner.id

      // Create design
      const designRes = await api.post(
        "/admin/designs",
        {
          name: `MP Design ${unique}`,
          description: "Design for multi-partner production selection",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // Create production runs via new endpoint
      const body = {
        assignments: [
          {
            partner_id: partner1Id,
            quantity: 3,
            role: "cutting",
          },
          {
            partner_id: partner2Id,
            quantity: 2,
            role: "stitching",
          },
        ],
      }

      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        body,
        adminHeaders
      )

      expect(createRes.status).toBe(201)
      expect(createRes.data.production_run).toBeDefined()
      expect(Array.isArray(createRes.data.children)).toBe(true)
      expect(createRes.data.children.length).toBe(2)

      const parentRunId = createRes.data.production_run.id

      // Query DB to ensure correct persistence
      const { data: parentRuns } = await query.graph({
        entity: "production_runs",
        fields: ["id", "status", "quantity", "design_id", "partner_id"],
        filters: { id: parentRunId },
        pagination: { skip: 0, take: 1 },
      })

      expect((parentRuns || []).length).toBe(1)
      const parent = (parentRuns || [])[0]
      expect(parent.design_id).toBe(designId)
      expect(parent.status).toBe("approved")
      expect(parent.partner_id).toBe(null)
      expect(Number(parent.quantity)).toBe(5)

      const { data: childrenRuns } = await query.graph({
        entity: "production_runs",
        fields: [
          "id",
          "status",
          "quantity",
          "design_id",
          "partner_id",
          "parent_run_id",
          "role",
        ],
        filters: { parent_run_id: parentRunId },
      })

      const children = childrenRuns || []
      expect(children.length).toBe(2)

      const byPartner = new Map<string, any>()
      for (const r of children) {
        byPartner.set(String(r.partner_id), r)
      }

      const c1 = byPartner.get(partner1Id)
      const c2 = byPartner.get(partner2Id)

      expect(c1).toBeDefined()
      expect(c2).toBeDefined()

      expect(c1.design_id).toBe(designId)
      expect(c1.status).toBe("approved")
      expect(c1.parent_run_id).toBe(parentRunId)
      expect(Number(c1.quantity)).toBe(3)
      expect(c1.role).toBe("cutting")

      expect(c2.design_id).toBe(designId)
      expect(c2.status).toBe("approved")
      expect(c2.parent_run_id).toBe(parentRunId)
      expect(Number(c2.quantity)).toBe(2)
      expect(c2.role).toBe("stitching")
    })

    /**
     * The route builds assignments itself from the design's linked partners
     * when the caller sends none, and has always read a top-level template
     * selection for them — but the schema never declared the field, so zod
     * stripped it and the auto-populated assignments got `[]` every time.
     * Those runs were created approved and then silently never dispatched.
     *
     * Ids, not names: a name may match two templates and be refused at
     * dispatch (#1261).
     */
    it("dispatches auto-populated assignments with the top-level template selection", async () => {
      const { api } = getSharedTestEnv()

      const unique = Date.now()

      const partnerRes = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `MP Auto Partner ${unique}`,
            handle: `mp-auto-partner-${unique}`,
          },
          admin: {
            email: `mp-auto-partner-admin-${unique}@jyt.test`,
            first_name: "MP",
            last_name: "Auto",
          },
        },
        adminHeaders
      )
      expect(partnerRes.status).toBe(201)
      const partnerId = partnerRes.data.partner.id

      const templateRes = await api.post(
        "/admin/task-templates",
        {
          name: `mp-auto-step-${unique}`,
          description: "Auto-populate step",
          priority: "medium",
          estimated_duration: 30,
          eventable: false,
          notifiable: false,
          metadata: { workflow_type: "production_run" },
          category: "Production",
        },
        adminHeaders
      )
      expect(templateRes.status).toBe(201)
      const templateId = templateRes.data.task_template.id

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `MP Auto Design ${unique}`,
          description: "Design with a linked partner and no explicit assignments",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      const designId = designRes.data.design.id

      // Link the partner to the design so the route can auto-populate from it.
      const linkRes = await api.post(
        `/admin/designs/${designId}/partner`,
        { partnerIds: [partnerId] },
        adminHeaders
      )
      expect([200, 201]).toContain(linkRes.status)

      // No `assignments` — the route builds them from the linked partner, and
      // the top-level selection is what those assignments must carry.
      const createRes = await api.post(
        `/admin/designs/${designId}/production-runs`,
        { quantity: 5, template_ids: [templateId] },
        adminHeaders
      )

      expect(createRes.status).toBe(201)
      const children = createRes.data.children || []
      expect(children.length).toBe(1)
      const childRunId = children[0].id

      // Before this fix the selection was stripped, so this reported nothing
      // dispatched and the run sat approved forever.
      expect(createRes.data.dispatch?.dispatched).toEqual([childRunId])
      expect(createRes.data.dispatch?.failed).toEqual([])

      const runRes = await api.get(
        `/admin/production-runs/${childRunId}`,
        adminHeaders
      )
      expect(String(runRes.data.production_run.status)).toBe("sent_to_partner")
      expect(runRes.data.production_run.dispatch_template_ids).toEqual([templateId])
      expect(runRes.data.production_run.dispatched_template_ids).toEqual([templateId])
    })

    /**
     * #1272 — the design page's "Create Production Run" drawer was the last
     * name-keyed dispatch caller. It has two branches, and both now send ids:
     *
     *  a) per-assignment templates — the route auto-dispatches each child with
     *     that assignment's OWN selection;
     *  b) no per-assignment templates — the drawer creates, then calls
     *     /send-to-production per partner-assigned run with the top-level
     *     selection.
     *
     * Ids matter because two templates can share a name (#1261) and dispatch
     * refuses an ambiguous one (#1262), so a name-keyed drawer could record an
     * intent that can never be carried out.
     */
    describe("dispatching the design drawer's branches by template id", () => {
      const setup = async (unique: number, partnerCount: number) => {
        const { api } = getSharedTestEnv()

        const partnerIds: string[] = []
        for (let i = 0; i < partnerCount; i++) {
          const res = await api.post(
            "/admin/partners",
            {
              partner: {
                name: `MP Ids Partner ${i} ${unique}`,
                handle: `mp-ids-partner-${i}-${unique}`,
              },
              admin: {
                email: `mp-ids-partner-${i}-admin-${unique}@jyt.test`,
                first_name: "MP",
                last_name: `Ids${i}`,
              },
            },
            adminHeaders
          )
          expect(res.status).toBe(201)
          partnerIds.push(res.data.partner.id)
        }

        const designRes = await api.post(
          "/admin/designs",
          {
            name: `MP Ids Design ${unique}`,
            description: "Design drawer dispatching by template id",
            design_type: "Original",
            status: "Commerce_Ready",
            priority: "Medium",
          },
          adminHeaders
        )
        expect(designRes.status).toBe(201)

        return { partnerIds, designId: designRes.data.design.id }
      }

      const createTemplate = async (name: string, category: string) => {
        const { api } = getSharedTestEnv()
        const res = await api.post(
          "/admin/task-templates",
          {
            name,
            description: "Drawer dispatch step",
            priority: "medium",
            estimated_duration: 30,
            eventable: false,
            notifiable: false,
            metadata: { workflow_type: "production_run" },
            category,
          },
          adminHeaders
        )
        expect(res.status).toBe(201)
        return res.data.task_template.id as string
      }

      it("dispatches each assignment with its own template_ids", async () => {
        const { api } = getSharedTestEnv()
        const unique = Date.now()

        const { partnerIds, designId } = await setup(unique, 2)
        const cutId = await createTemplate(`mp-ids-cut-${unique}`, "Pre Production")
        const stitchId = await createTemplate(`mp-ids-stitch-${unique}`, "Production")

        const createRes = await api.post(
          `/admin/designs/${designId}/production-runs`,
          {
            assignments: [
              {
                partner_id: partnerIds[0],
                quantity: 3,
                role: "cutting",
                template_ids: [cutId],
              },
              {
                partner_id: partnerIds[1],
                quantity: 2,
                role: "stitching",
                template_ids: [stitchId],
              },
            ],
          },
          adminHeaders
        )

        expect(createRes.status).toBe(201)
        const children = createRes.data.children || []
        expect(children.length).toBe(2)
        expect(createRes.data.dispatch?.failed).toEqual([])
        expect((createRes.data.dispatch?.dispatched || []).sort()).toEqual(
          children.map((c: any) => String(c.id)).sort()
        )

        // Each child carries ITS OWN selection — a batch-wide set would be
        // wrong for most runs (#1263 makes the same point about bulk produce).
        const expected = new Map<string, string>([
          [String(partnerIds[0]), cutId],
          [String(partnerIds[1]), stitchId],
        ])

        for (const child of children) {
          const runRes = await api.get(
            `/admin/production-runs/${child.id}`,
            adminHeaders
          )
          const run = runRes.data.production_run
          const templateId = expected.get(String(run.partner_id))
          expect(templateId).toBeDefined()
          expect(String(run.status)).toBe("sent_to_partner")
          expect(run.dispatch_template_ids).toEqual([templateId])
          expect(run.dispatched_template_ids).toEqual([templateId])
        }
      })

      it("dispatches a created run through /send-to-production by id", async () => {
        const { api } = getSharedTestEnv()
        const unique = Date.now() + 1

        const { partnerIds, designId } = await setup(unique, 1)
        const templateId = await createTemplate(
          `mp-ids-global-${unique}`,
          "Production"
        )

        // The drawer's other branch: assignments carry no templates, so the
        // run is created approved and dispatched in a second call.
        const createRes = await api.post(
          `/admin/designs/${designId}/production-runs`,
          {
            assignments: [{ partner_id: partnerIds[0], quantity: 4 }],
          },
          adminHeaders
        )
        expect(createRes.status).toBe(201)
        const children = createRes.data.children || []
        expect(children.length).toBe(1)
        const childRunId = String(children[0].id)
        expect(createRes.data.dispatch?.dispatched).toEqual([])

        const sendRes = await api.post(
          `/admin/production-runs/${childRunId}/send-to-production`,
          { template_ids: [templateId] },
          adminHeaders
        )
        expect([200, 201]).toContain(sendRes.status)

        const runRes = await api.get(
          `/admin/production-runs/${childRunId}`,
          adminHeaders
        )
        expect(String(runRes.data.production_run.status)).toBe("sent_to_partner")
        expect(runRes.data.production_run.dispatched_template_ids).toEqual([
          templateId,
        ])
      })
    })
  })
})
