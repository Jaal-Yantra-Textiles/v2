/**
 * Partner design ↔ inventory BOM (roadmap #6, Phase 2).
 *
 * A partner links GLOBAL inventory items to their OWN design as a
 * bill-of-materials (planned_quantity per item), lists it, updates a
 * line, and delinks. Ownership is enforced — a partner can't touch the
 * BOM of a design they don't own.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-design-inventory-bom
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(180_000)

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `pbom-${label}-${unique}@jyt.test`
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
      name: `PBom ${label} ${unique}`,
      handle: `pbom-${label}-${unique}`,
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

async function createInventoryItem(api: any, adminHeaders: any, title: string) {
  const res = await api.post(
    "/admin/inventory-items",
    { title, description: `${title} for BOM test` },
    adminHeaders
  )
  expect(res.status).toBe(200)
  return res.data.inventory_item.id as string
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner design ↔ inventory BOM (roadmap 6, Phase 2)", () => {
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

    async function ownDesign(partnerHeaders: any) {
      const res = await api.post(
        "/partners/designs",
        { name: "BOM Design", design_type: "Original" },
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(201)
      return res.data.design.id as string
    }

    it("links global inventory to a partner-owned design with planned qty", async () => {
      const { partnerHeaders } = await createPartner(api, "link")
      const designId = await ownDesign(partnerHeaders)
      const invId = await createInventoryItem(api, adminHeaders, "Cotton Twill")

      const linkRes = await api.post(
        `/partners/designs/${designId}/inventory`,
        { inventoryItems: [{ inventoryId: invId, plannedQuantity: 12 }] },
        { headers: partnerHeaders }
      )
      expect(linkRes.status).toBe(201)
      const items = linkRes.data.inventory_items || []
      const line = items.find((i: any) => i.inventory_item_id === invId)
      expect(line).toBeDefined()
      expect(Number(line.planned_quantity)).toBe(12)

      // GET returns the same BOM.
      const getRes = await api.get(`/partners/designs/${designId}/inventory`, {
        headers: partnerHeaders,
      })
      expect(getRes.status).toBe(200)
      expect(
        (getRes.data.inventory_items || []).map((i: any) => i.inventory_item_id)
      ).toContain(invId)
    })

    it("updates a BOM line's planned quantity, then delinks it", async () => {
      const { partnerHeaders } = await createPartner(api, "edit")
      const designId = await ownDesign(partnerHeaders)
      const invId = await createInventoryItem(api, adminHeaders, "Silk Charmeuse")

      await api.post(
        `/partners/designs/${designId}/inventory`,
        { inventoryItems: [{ inventoryId: invId, plannedQuantity: 5 }] },
        { headers: partnerHeaders }
      )

      // PATCH planned qty.
      const patch = await api.patch(
        `/partners/designs/${designId}/inventory/${invId}`,
        { plannedQuantity: 20 },
        { headers: partnerHeaders }
      )
      expect(patch.status).toBe(200)
      const patched = (patch.data.inventory_items || []).find(
        (i: any) => i.inventory_item_id === invId
      )
      expect(Number(patched.planned_quantity)).toBe(20)

      // DELETE (delink).
      const del = await api.delete(
        `/partners/designs/${designId}/inventory/delink`,
        { headers: partnerHeaders, data: { inventoryIds: [invId] } }
      )
      expect(del.status).toBe(200)
      expect(
        (del.data.inventory_items || []).map((i: any) => i.inventory_item_id)
      ).not.toContain(invId)
    })

    it("blocks a partner from touching another partner's design BOM", async () => {
      const { partnerHeaders: owner } = await createPartner(api, "owner")
      const { partnerHeaders: intruder } = await createPartner(api, "intruder")
      const designId = await ownDesign(owner)
      const invId = await createInventoryItem(api, adminHeaders, "Wool Blend")

      const res = await api.post(
        `/partners/designs/${designId}/inventory`,
        { inventoryItems: [{ inventoryId: invId, plannedQuantity: 3 }] },
        { headers: intruder, validateStatus: () => true }
      )
      // NOT_ALLOWED → 400 (or 401 if auth rejected upstream).
      expect([400, 401, 403]).toContain(res.status)
    })
  })
})
