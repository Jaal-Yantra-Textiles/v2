/**
 * Partner production-run cost summary (roadmap #6, Phase 5).
 *
 * A partner creates a self-approved run, logs a costed consumption, and
 * reads the cost-summary (admin-parity numbers). Scoped: only the
 * owning partner can read it.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-run-cost-summary
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"
jest.setTimeout(180_000)

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `prcs-${label}-${unique}@jyt.test`
  await api.post("/auth/partner/emailpass/register", {
    email,
    password: PARTNER_PASSWORD,
  })
  let login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login.data.token}`,
  }
  const partnerRes = await api.post(
    "/partners",
    {
      name: `PRcs ${label} ${unique}`,
      handle: `prcs-${label}-${unique}`,
      admin: { email, first_name: "Test", last_name: "Partner" },
    },
    { headers }
  )
  expect(partnerRes.status).toBe(200)
  login = await api.post("/auth/partner/emailpass", {
    email,
    password: PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login.data.token}` }
  return { partnerId: partnerRes.data.partner.id as string, partnerHeaders: headers }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner run cost-summary (roadmap 6, Phase 5)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      try {
        await api.post(
          "/admin/email-templates",
          {
            name: "Admin Partner Created",
            template_key: "partner-created-from-admin",
            subject: "s",
            html_content: "<div>ok</div>",
            from: "t@t.com",
            variables: {},
            template_type: "email",
          },
          adminHeaders
        )
      } catch {
        /* pre-existing */
      }
    })

    async function ownDesignAndRun(partnerHeaders: any) {
      const dRes = await api.post(
        "/partners/designs",
        { name: "CostSum Design", design_type: "Original" },
        { headers: partnerHeaders }
      )
      const designId = dRes.data.design.id
      const rRes = await api.post(
        `/partners/designs/${designId}/production-runs`,
        { quantity: 4, execution_mode: "in_house" },
        { headers: partnerHeaders }
      )
      expect(rRes.status).toBe(201)
      return { designId, runId: rRes.data.production_run.id as string }
    }

    it("returns a cost-summary reflecting logged consumption", async () => {
      const { partnerHeaders } = await createPartner(api, "calc")
      const { runId } = await ownDesignAndRun(partnerHeaders)

      const invRes = await api.post(
        "/admin/inventory-items",
        { title: "CostSum Cotton", description: "cost summary test" },
        adminHeaders
      )
      const invId = invRes.data.inventory_item.id

      // Log a production consumption with a unit cost (2 units × 50).
      const log = await api.post(
        `/partners/production-runs/${runId}/consumption-logs`,
        {
          inventoryItemId: invId,
          consumptionType: "production",
          quantity: 2,
          unitCost: 50,
          unitOfMeasure: "Meter",
        },
        { headers: partnerHeaders, validateStatus: () => true }
      )
      expect([200, 201]).toContain(log.status)

      const res = await api.get(
        `/partners/production-runs/${runId}/cost-summary`,
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      const cs = res.data.cost_summary
      expect(cs.production_run_id).toBe(runId)
      expect(cs.material.total).toBe(100) // 2 × 50
      expect(cs.grand_total).toBe(100)
      expect(cs.total_consumption_logs).toBeGreaterThanOrEqual(1)
    })

    it("blocks a partner from reading another partner's run cost-summary", async () => {
      const { partnerHeaders: owner } = await createPartner(api, "owner")
      const { partnerHeaders: intruder } = await createPartner(api, "intruder")
      const { runId } = await ownDesignAndRun(owner)

      const res = await api.get(
        `/partners/production-runs/${runId}/cost-summary`,
        { headers: intruder, validateStatus: () => true }
      )
      expect([400, 401, 404]).toContain(res.status)
    })
  })
})
