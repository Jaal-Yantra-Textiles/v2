import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { seedCommonEmailTemplates } from "../helpers/seed-email-templates"
import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import backfillCancelledDesignRuns from "../../src/scripts/backfill-cancelled-design-runs"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(60 * 1000)

// Verifies the legacy-cancelled-design migration: a marker-only design
// (no runs) gets a terminal cancelled run + the marker cleared, so status
// derives purely from production runs.
setupSharedTestSuite(() => {
  describe("backfill-cancelled-design-runs", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      await createAdminUser(getSharedTestEnv().getContainer())
      adminHeaders = await getAuthHeaders(getSharedTestEnv().api)
      await seedCommonEmailTemplates(getSharedTestEnv().api, adminHeaders)
    })

    it("creates a cancelled run + clears the marker for a marker-only design", async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      const unique = Date.now()

      // partner
      const email = `bf-cancel-${unique}@jyt.test`
      await api.post("/auth/partner/emailpass/register", { email, password: "supersecret" })
      let login = await api.post("/auth/partner/emailpass", { email, password: "supersecret" })
      const pres = await api.post(
        "/partners",
        { name: `BF Cancel ${unique}`, handle: `bf-cancel-${unique}`, admin: { email, first_name: "BF", last_name: "C" } },
        { headers: { Authorization: `Bearer ${login.data.token}` } }
      )
      const partnerId = pres.data.partner.id

      // design (no runs) + cancel marker set directly
      const dres = await api.post(
        "/admin/designs",
        { name: `BF Cancel Design ${unique}`, description: "x", design_type: "Original", status: "Conceptual", priority: "Medium" },
        adminHeaders
      )
      const designId = dres.data.design.id

      const designService: any = container.resolve(DESIGN_MODULE)
      await designService.updateDesigns({
        id: designId,
        metadata: {
          partner_assignment_cancelled_at: new Date().toISOString(),
          partner_assignment_cancelled_partner_id: partnerId,
        },
      })

      // run the migration scoped to this design
      await backfillCancelledDesignRuns({ container, args: [`--design-ids=${designId}`] } as any)

      // a cancelled run now exists for (design, partner)
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: runs } = await query.graph({
        entity: "production_runs",
        filters: { design_id: designId, partner_id: partnerId },
        fields: ["id", "status"],
      })
      expect(runs.length).toBe(1)
      expect(runs[0].status).toBe("cancelled")

      // marker cleared
      const { data: designs } = await query.graph({
        entity: "design",
        filters: { id: designId },
        fields: ["id", "metadata"],
      })
      expect((designs[0].metadata || {}).partner_assignment_cancelled_at == null).toBe(true)

      // idempotent: a second run creates no duplicate
      await backfillCancelledDesignRuns({ container, args: [`--design-ids=${designId}`] } as any)
      const { data: runs2 } = await query.graph({
        entity: "production_runs",
        filters: { design_id: designId, partner_id: partnerId },
        fields: ["id"],
      })
      expect(runs2.length).toBe(1)
    })
  })
})
