/**
 * Partner design CRUD — self-serve, isolated (roadmap #6, Phase 1).
 *
 * Verifies that a partner can create / edit / delete their OWN designs,
 * that those designs are isolated (a second partner can't touch them),
 * and that partner-owned designs are excluded from the global admin
 * list by default but surfaced with ?include_partner_owned=true.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-design-crud
 */

import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import designPartnersLink from "../../src/links/design-partners-link"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(180_000)

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `pdcrud-${label}-${unique}@jyt.test`
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
      name: `PDCrud ${label} ${unique}`,
      handle: `pdcrud-${label}-${unique}`,
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

  describe("Partner design CRUD (roadmap 6, Phase 1)", () => {
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

    it("partner creates a design — owned, visible to creator, isolated from others", async () => {
      const { partnerId, partnerHeaders } = await createPartner(api, "owner")
      const { partnerHeaders: otherHeaders } = await createPartner(api, "other")

      const createRes = await api.post(
        "/partners/designs",
        {
          name: "My Self-Serve Jacket",
          description: "partner-created",
          design_type: "Original",
          priority: "High",
        },
        { headers: partnerHeaders }
      )
      expect(createRes.status).toBe(201)
      const designId = createRes.data.design.id
      expect(designId).toBeDefined()

      // owner_partner_id stamped from auth, not body.
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: rows } = await query.graph({
        entity: "design",
        filters: { id: designId },
        fields: ["id", "owner_partner_id", "origin_source"],
      })
      expect((rows?.[0] as any)?.owner_partner_id).toBe(partnerId)
      expect((rows?.[0] as any)?.origin_source).toBe("manual")

      // Creator sees it in their listing.
      const ownerList = await api.get("/partners/designs?limit=100", {
        headers: partnerHeaders,
      })
      expect(
        (ownerList.data.designs || []).map((d: any) => d.id)
      ).toContain(designId)

      // Second partner does NOT see it.
      const otherList = await api.get("/partners/designs?limit=100", {
        headers: otherHeaders,
      })
      expect(
        (otherList.data.designs || []).map((d: any) => d.id)
      ).not.toContain(designId)

      // Second partner cannot read the detail (not linked).
      const otherDetail = await api.get(`/partners/designs/${designId}`, {
        headers: otherHeaders,
        validateStatus: () => true,
      })
      expect(otherDetail.status).toBe(404)
    })

    it("excludes partner-owned designs from the admin global list by default", async () => {
      const { partnerHeaders } = await createPartner(api, "adminhide")
      const created = await api.post(
        "/partners/designs",
        { name: "Hidden From Admin", design_type: "Original" },
        { headers: partnerHeaders }
      )
      const designId = created.data.design.id

      // Default admin list excludes it.
      const defaultList = await api.get("/admin/designs?limit=200", adminHeaders)
      expect(
        (defaultList.data.designs || []).map((d: any) => d.id)
      ).not.toContain(designId)

      // Explicit include surfaces it.
      const inclList = await api.get(
        "/admin/designs?limit=200&include_partner_owned=true",
        adminHeaders
      )
      expect(
        (inclList.data.designs || []).map((d: any) => d.id)
      ).toContain(designId)
    })

    it("partner edits own design; cannot edit another partner's", async () => {
      const { partnerHeaders } = await createPartner(api, "editor")
      const { partnerHeaders: intruderHeaders } = await createPartner(api, "intruder")

      const created = await api.post(
        "/partners/designs",
        { name: "Editable", design_type: "Original" },
        { headers: partnerHeaders }
      )
      const designId = created.data.design.id

      // Owner edits.
      const upd = await api.put(
        `/partners/designs/${designId}`,
        { name: "Edited Name", priority: "Urgent" },
        { headers: partnerHeaders }
      )
      expect(upd.status).toBe(200)
      expect(upd.data.design.name).toBe("Edited Name")

      // Intruder blocked. MedusaError.NOT_ALLOWED maps to HTTP 400
      // (Medusa's error handler), 401 if auth is rejected upstream.
      const intruderUpd = await api.put(
        `/partners/designs/${designId}`,
        { name: "Hacked" },
        { headers: intruderHeaders, validateStatus: () => true }
      )
      expect([400, 401, 403]).toContain(intruderUpd.status)
      // And the design is untouched.
      const stillOwner = await api.get(`/partners/designs/${designId}`, {
        headers: partnerHeaders,
      })
      expect(stillOwner.data.design.name).toBe("Edited Name")
    })

    it("partner deletes own design", async () => {
      const { partnerHeaders } = await createPartner(api, "deleter")
      const created = await api.post(
        "/partners/designs",
        { name: "Deletable", design_type: "Original" },
        { headers: partnerHeaders }
      )
      const designId = created.data.design.id

      const del = await api.delete(`/partners/designs/${designId}`, {
        headers: partnerHeaders,
      })
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      // No longer in the partner's list.
      const list = await api.get("/partners/designs?limit=100", {
        headers: partnerHeaders,
      })
      expect((list.data.designs || []).map((d: any) => d.id)).not.toContain(
        designId
      )

      // The design ↔ partner link row was dismissed, not orphaned.
      const container = getContainer()
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: leftoverLinks } = await query.graph({
        entity: designPartnersLink.entryPoint,
        filters: { design_id: designId },
        fields: ["design_id", "partner_id"],
      })
      expect((leftoverLinks || []).length).toBe(0)
    })
  })
})
