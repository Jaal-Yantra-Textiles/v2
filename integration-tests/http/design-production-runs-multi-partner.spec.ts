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

      // Create the email template used by partner creation workflows (ignore if exists)
      try {
        await api.post(
          "/admin/email-templates",
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
          adminHeaders
        )
      } catch (e: any) {
        // ok
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
  })
})
