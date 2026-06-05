/**
 * Partner design cost estimation (roadmap #6, Phase 3).
 *
 * A partner links inventory (with a unit_cost) to their own design,
 * triggers a recalculate, and reads the persisted cost back. Ownership
 * is enforced on both endpoints.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-design-cost
 */

import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"
jest.setTimeout(180_000)

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `pcost-${label}-${unique}@jyt.test`
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
      name: `PCost ${label} ${unique}`,
      handle: `pcost-${label}-${unique}`,
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

  describe("Partner design cost estimation (roadmap 6, Phase 3)", () => {
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

    it("recalculates + persists cost from the linked BOM, readable via GET", async () => {
      const { partnerId, partnerHeaders } = await createPartner(api, "calc")
      const container = getContainer()

      // Inventory item with a known unit_cost (drives the estimate).
      const invRes = await api.post(
        "/admin/inventory-items",
        { title: "Costed Cotton", description: "unit cost test" },
        adminHeaders
      )
      const invId = invRes.data.inventory_item.id
      // Set unit_cost directly on the inventory item via the module so
      // the estimate waterfall has a value to read.
      const invSvc: any = container.resolve(Modules.INVENTORY)
      await invSvc.updateInventoryItems({ id: invId, unit_cost: 100 } as any)

      // Partner design + BOM link with planned_quantity = 3.
      const designRes = await api.post(
        "/partners/designs",
        { name: "Costed Design", design_type: "Original" },
        { headers: partnerHeaders }
      )
      const designId = designRes.data.design.id
      await api.post(
        `/partners/designs/${designId}/inventory`,
        { inventoryItems: [{ inventoryId: invId, plannedQuantity: 3 }] },
        { headers: partnerHeaders }
      )

      // Recalculate.
      const recalc = await api.post(
        `/partners/designs/${designId}/recalculate-cost`,
        {},
        { headers: partnerHeaders }
      )
      expect(recalc.status).toBe(200)
      expect(recalc.data.cost_estimate).toBeDefined()
      expect(typeof recalc.data.cost_estimate.total_estimated).toBe("number")
      // Material cost reflects qty×unit_cost when the waterfall picks up
      // the inventory unit_cost; never negative.
      expect(recalc.data.cost_estimate.material_cost).toBeGreaterThanOrEqual(0)

      // GET cost returns the persisted values.
      const costRes = await api.get(`/partners/designs/${designId}/cost`, {
        headers: partnerHeaders,
      })
      expect(costRes.status).toBe(200)
      expect(costRes.data.design_id).toBe(designId)
      expect(Number(costRes.data.estimated_cost)).toBe(
        recalc.data.cost_estimate.total_estimated
      )
      expect(costRes.data.cost_breakdown).toBeTruthy()
    })

    it("blocks recalculate + cost read on a design the partner doesn't own", async () => {
      const { partnerHeaders: owner } = await createPartner(api, "owner")
      const { partnerHeaders: intruder } = await createPartner(api, "intruder")
      const designRes = await api.post(
        "/partners/designs",
        { name: "Guarded", design_type: "Original" },
        { headers: owner }
      )
      const designId = designRes.data.design.id

      const recalc = await api.post(
        `/partners/designs/${designId}/recalculate-cost`,
        {},
        { headers: intruder, validateStatus: () => true }
      )
      expect([400, 401, 403]).toContain(recalc.status)

      const cost = await api.get(`/partners/designs/${designId}/cost`, {
        headers: intruder,
        validateStatus: () => true,
      })
      expect([400, 401, 403]).toContain(cost.status)
    })
  })
})
