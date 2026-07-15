import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartner(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-layout-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `LayoutTest ${unique}`,
      handle: `layouttest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Layout" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the bearer token carries partner actor context.
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { headers, partnerId }
}

const ZONE = "sidebar.main"

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner LayoutComposer configuration API (#338)", () => {
    let partner: Awaited<ReturnType<typeof createPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      await getAuthHeaders(api)
      partner = await createPartner(api)
    })

    it("GET returns nulls before any configuration is saved", async () => {
      const res = await api.get(
        `/partners/layouts/${ZONE}/configuration`,
        { headers: partner.headers }
      )
      expect(res.status).toBe(200)
      expect(res.data.personal_configuration).toBeNull()
      expect(res.data.default_configuration).toBeNull()
      expect(res.data.active_scope).toBe("personal")
    })

    it("POST creates a personal configuration then reads it back", async () => {
      const configuration = {
        widgets: {
          "nav.customers": { hidden: true },
          "nav.designs": { order: 0 },
        },
      }

      const post = await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { configuration },
        { headers: partner.headers }
      )
      expect(post.status).toBe(200)
      expect(post.data.layout_configuration.partner_id).toBe(partner.partnerId)
      expect(post.data.layout_configuration.is_default).toBe(false)
      expect(post.data.layout_configuration.configuration).toEqual(configuration)

      const get = await api.get(
        `/partners/layouts/${ZONE}/configuration`,
        { headers: partner.headers }
      )
      expect(get.data.personal_configuration.configuration).toEqual(configuration)
      expect(get.data.active_scope).toBe("personal")
    })

    it("POST upserts the same scope (no duplicate row)", async () => {
      const first = await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { configuration: { widgets: { a: { hidden: true } } } },
        { headers: partner.headers }
      )
      const firstId = first.data.layout_configuration.id

      const second = await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { configuration: { widgets: { a: { hidden: false }, b: { order: 2 } } } },
        { headers: partner.headers }
      )
      expect(second.data.layout_configuration.id).toBe(firstId)
      expect(second.data.layout_configuration.configuration.widgets.a.hidden).toBe(false)
      expect(second.data.layout_configuration.configuration.widgets.b.order).toBe(2)
    })

    it("personal and default scopes coexist for the same zone", async () => {
      await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { is_default: false, configuration: { widgets: { a: { hidden: true } } } },
        { headers: partner.headers }
      )
      await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { is_default: true, configuration: { widgets: { a: { hidden: false } } } },
        { headers: partner.headers }
      )

      const get = await api.get(
        `/partners/layouts/${ZONE}/configuration`,
        { headers: partner.headers }
      )
      expect(get.data.personal_configuration.configuration.widgets.a.hidden).toBe(true)
      expect(get.data.default_configuration.configuration.widgets.a.hidden).toBe(false)
      // Personal wins.
      expect(get.data.active_scope).toBe("personal")
    })

    it("DELETE removes the personal override but leaves the default", async () => {
      await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { is_default: false, configuration: { widgets: { a: { hidden: true } } } },
        { headers: partner.headers }
      )
      await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { is_default: true, configuration: { widgets: { a: { hidden: false } } } },
        { headers: partner.headers }
      )

      const del = await api.delete(
        `/partners/layouts/${ZONE}/configuration`,
        { headers: partner.headers }
      )
      expect(del.status).toBe(200)
      expect(del.data.deleted).toBe(true)

      const get = await api.get(
        `/partners/layouts/${ZONE}/configuration`,
        { headers: partner.headers }
      )
      expect(get.data.personal_configuration).toBeNull()
      expect(get.data.default_configuration).not.toBeNull()
      expect(get.data.active_scope).toBe("default")
    })

    it("configurations list returns the partner's saved configs with a count", async () => {
      await api.post(
        `/partners/layouts/${ZONE}/configuration`,
        { configuration: { widgets: {} } },
        { headers: partner.headers }
      )
      await api.post(
        `/partners/layouts/home/configuration`,
        { configuration: { widgets: {} } },
        { headers: partner.headers }
      )

      const res = await api.get("/partners/layouts/configurations", {
        headers: partner.headers,
      })
      expect(res.status).toBe(200)
      expect(res.data.count).toBe(2)
      expect(res.data.layout_configurations).toHaveLength(2)
    })

    it("POST rejects an unknown widget field with 400 (strict schema)", async () => {
      const res = await api
        .post(
          `/partners/layouts/${ZONE}/configuration`,
          { configuration: { widgets: { a: { bogus: true } } } },
          { headers: partner.headers }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("requires partner authentication", async () => {
      const res = await api
        .get(`/partners/layouts/${ZONE}/configuration`)
        .catch((e: any) => e.response)
      expect([401, 403]).toContain(res.status)
    })
  })
})
