/**
 * Partner design-brief CRUD — self-serve, ownership-scoped (roadmap #604, slice C).
 *
 * Mirrors the admin slice-B brief contract (`/admin/designs/:id/brief`) on the
 * partner side: a partner can read + write the brief of their OWN design, the
 * routes are isolated (a second partner gets 404), POST is a full replace, and
 * PUT is a partial merge. cost_currency is never nulled on a POST replace.
 *
 * Run:
 *   pnpm test:integration:http:shared ./integration-tests/http/partner-design-brief
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(180_000)

async function createPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `pdbrief-${label}-${unique}@jyt.test`
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
      name: `PDBrief ${label} ${unique}`,
      handle: `pdbrief-${label}-${unique}`,
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

async function createOwnedDesign(api: any, partnerHeaders: any) {
  const res = await api.post(
    "/partners/designs",
    { name: "Brief Test Design", design_type: "Original" },
    { headers: partnerHeaders }
  )
  expect(res.status).toBe(201)
  return res.data.design.id as string
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner design brief (roadmap #604 slice C)", () => {
    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      // Partner creation fires a "partner-created-from-admin" email — seed the
      // template so the /partners POST doesn't 400 on a missing template.
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

    it("GET returns a fully-null brief for a fresh design", async () => {
      const { partnerHeaders } = await createPartner(api, "freshget")
      const designId = await createOwnedDesign(api, partnerHeaders)

      const res = await api.get(`/partners/designs/${designId}/brief`, {
        headers: partnerHeaders,
      })
      expect(res.status).toBe(200)
      expect(res.data.brief).toEqual({
        concept_theme: null,
        persona: null,
        competitors: null,
        price_point: null,
        design_budget: null,
        cost_currency: null,
      })
    })

    it("POST replaces the whole brief and GET reads it back", async () => {
      const { partnerHeaders } = await createPartner(api, "post")
      const designId = await createOwnedDesign(api, partnerHeaders)

      const persona = { age_range: "25-34", values: ["sustainable", "modern"] }
      const competitors = [
        { name: "Acme", url: "https://acme.example", differentiator: "cheap" },
      ]
      const postRes = await api.post(
        `/partners/designs/${designId}/brief`,
        {
          concept_theme: "Coastal minimalism",
          persona,
          competitors,
          price_point: "luxury",
          design_budget: 1500,
          cost_currency: "inr",
        },
        { headers: partnerHeaders }
      )
      expect(postRes.status).toBe(200)
      expect(postRes.data.brief).toEqual({
        concept_theme: "Coastal minimalism",
        persona,
        competitors,
        price_point: "luxury",
        design_budget: 1500,
        cost_currency: "inr",
      })

      const getRes = await api.get(`/partners/designs/${designId}/brief`, {
        headers: partnerHeaders,
      })
      expect(getRes.data.brief.concept_theme).toBe("Coastal minimalism")
      expect(getRes.data.brief.price_point).toBe("luxury")
      expect(getRes.data.brief.design_budget).toBe(1500)
    })

    it("POST is a full replace — unset fields become null (cost_currency preserved)", async () => {
      const { partnerHeaders } = await createPartner(api, "replace")
      const designId = await createOwnedDesign(api, partnerHeaders)

      await api.post(
        `/partners/designs/${designId}/brief`,
        { concept_theme: "First", price_point: "budget", cost_currency: "inr" },
        { headers: partnerHeaders }
      )
      // Second POST omits everything except concept_theme.
      const res = await api.post(
        `/partners/designs/${designId}/brief`,
        { concept_theme: "Second" },
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.brief.concept_theme).toBe("Second")
      expect(res.data.brief.price_point).toBeNull()
      // cost_currency is shared with manufacturing cost — never nulled on replace.
      expect(res.data.brief.cost_currency).toBe("inr")
    })

    it("PUT partially merges — only provided keys change", async () => {
      const { partnerHeaders } = await createPartner(api, "put")
      const designId = await createOwnedDesign(api, partnerHeaders)

      await api.post(
        `/partners/designs/${designId}/brief`,
        { concept_theme: "Keep me", price_point: "mid_market" },
        { headers: partnerHeaders }
      )
      const res = await api.put(
        `/partners/designs/${designId}/brief`,
        { price_point: "luxury" },
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.brief.concept_theme).toBe("Keep me")
      expect(res.data.brief.price_point).toBe("luxury")
    })

    it("rejects an invalid price_point enum", async () => {
      const { partnerHeaders } = await createPartner(api, "badenum")
      const designId = await createOwnedDesign(api, partnerHeaders)

      const res = await api.post(
        `/partners/designs/${designId}/brief`,
        { price_point: "platinum" },
        { headers: partnerHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(400)
    })

    it("isolates the brief — a second partner cannot read or write it", async () => {
      const { partnerHeaders } = await createPartner(api, "owner2")
      const { partnerHeaders: otherHeaders } = await createPartner(api, "intruder")
      const designId = await createOwnedDesign(api, partnerHeaders)

      // assertPartnerOwnsDesign throws NOT_ALLOWED (→ 400) for an owner
      // mismatch on an existing design (404 only when the design is absent).
      const getRes = await api.get(`/partners/designs/${designId}/brief`, {
        headers: otherHeaders,
        validateStatus: () => true,
      })
      expect([400, 404]).toContain(getRes.status)

      const postRes = await api.post(
        `/partners/designs/${designId}/brief`,
        { concept_theme: "hijack" },
        { headers: otherHeaders, validateStatus: () => true }
      )
      expect([400, 404]).toContain(postRes.status)
    })
  })
})
