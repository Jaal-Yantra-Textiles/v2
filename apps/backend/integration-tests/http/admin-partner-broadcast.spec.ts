import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

/**
 * Integration coverage for #453 — admin broadcast notifications.
 * POST /admin/partners/notifications/broadcast fans a feed notification out
 * to all (or a filtered subset of) partners, which then surface on each
 * partner's bell feed (GET /partners/notifications).
 */
async function registerPartner(api: any, label: string) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `bcast-${label}-${unique}@medusa-test.com`

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
      name: `Bcast ${label} ${unique}`,
      handle: `bcast-${label}-${unique}`,
      admin: { email, first_name: "Admin", last_name: label },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the token carries the partner association.
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { partnerId, headers }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin partner broadcast notifications", () => {
    let adminHeaders: Record<string, any>
    let p1: Awaited<ReturnType<typeof registerPartner>>
    let p2: Awaited<ReturnType<typeof registerPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      p1 = await registerPartner(api, "one")
      p2 = await registerPartner(api, "two")
    })

    it("broadcasts to all partners and lands on each bell feed", async () => {
      const res = await api.post(
        "/admin/partners/notifications/broadcast",
        {
          title: "Platform maintenance tonight",
          description: "Expect a short downtime at 02:00 IST.",
          url: "/announcements/maint",
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.broadcast.total).toBeGreaterThanOrEqual(2)
      expect(res.data.broadcast.failed).toBe(0)
      expect(res.data.broadcast.sent).toBe(res.data.broadcast.total)
      expect(res.data.partner_ids).toEqual(
        expect.arrayContaining([p1.partnerId, p2.partnerId])
      )

      const feed1 = await api.get("/partners/notifications", {
        headers: p1.headers,
      })
      const titles1 = feed1.data.notifications.map((n: any) => n.data?.title)
      expect(titles1).toContain("Platform maintenance tonight")

      const feed2 = await api.get("/partners/notifications", {
        headers: p2.headers,
      })
      const titles2 = feed2.data.notifications.map((n: any) => n.data?.title)
      expect(titles2).toContain("Platform maintenance tonight")
    })

    it("targets only the explicit partner_ids when provided", async () => {
      const res = await api.post(
        "/admin/partners/notifications/broadcast",
        {
          title: "Targeted note",
          partner_ids: [p1.partnerId],
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.partner_ids).toEqual([p1.partnerId])
      expect(res.data.broadcast.total).toBe(1)

      const feed2 = await api.get("/partners/notifications", {
        headers: p2.headers,
      })
      const titles2 = feed2.data.notifications.map((n: any) => n.data?.title)
      expect(titles2).not.toContain("Targeted note")
    })

    it("drops unknown partner ids from the explicit target list", async () => {
      const res = await api.post(
        "/admin/partners/notifications/broadcast",
        {
          title: "Filtered targets",
          partner_ids: [p1.partnerId, "partner_does_not_exist"],
        },
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.partner_ids).toEqual([p1.partnerId])
      expect(res.data.broadcast.total).toBe(1)
    })

    it("rejects a broadcast without a title", async () => {
      await expect(
        api.post(
          "/admin/partners/notifications/broadcast",
          { description: "no title here" },
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
    })
  })
})
