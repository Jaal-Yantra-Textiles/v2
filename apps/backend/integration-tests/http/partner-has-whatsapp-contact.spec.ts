import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(60 * 1000)

// Roadmap bug #25d — the admin partner list surfaces a
// `has_whatsapp_contact` flag so the production-run assignment UI can
// warn when a partner has no reachable WhatsApp recipient. The flag
// mirrors seed-partner-run-whatsapp-flow.ts: a verified whatsapp_number
// wins, otherwise the first active admin with a phone.
setupSharedTestSuite(() => {
  describe("Admin partner list → has_whatsapp_contact flag", () => {
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    it("is true when the partner has an active admin with a phone", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now()

      const res = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `WA Yes ${unique}`,
            handle: `wa-yes-${unique}`,
          },
          admin: {
            email: `wa-yes-admin-${unique}@jyt.test`,
            first_name: "WA",
            last_name: "Yes",
            phone: "+919900000000",
          },
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const partnerId = res.data.partner.id

      const list = await api.get(
        `/admin/persons/partner?handle=wa-yes-${unique}&limit=5`,
        adminHeaders
      )
      expect(list.status).toBe(200)
      const found = list.data.partners.find((p: any) => p.id === partnerId)
      expect(found).toBeDefined()
      expect(found.has_whatsapp_contact).toBe(true)
    })

    it("is false when the partner has no verified number and no admin phone", async () => {
      const { api } = getSharedTestEnv()
      const unique = Date.now() + 1

      const res = await api.post(
        "/admin/partners",
        {
          partner: {
            name: `WA No ${unique}`,
            handle: `wa-no-${unique}`,
          },
          admin: {
            email: `wa-no-admin-${unique}@jyt.test`,
            first_name: "WA",
            last_name: "No",
            // no phone
          },
        },
        adminHeaders
      )
      expect(res.status).toBe(201)
      const partnerId = res.data.partner.id

      const list = await api.get(
        `/admin/persons/partner?handle=wa-no-${unique}&limit=5`,
        adminHeaders
      )
      expect(list.status).toBe(200)
      const found = list.data.partners.find((p: any) => p.id === partnerId)
      expect(found).toBeDefined()
      expect(found.has_whatsapp_contact).toBe(false)
    })
  })
})
