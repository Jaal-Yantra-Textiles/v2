import { setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

/**
 * #2320 — partner admins log in with their phone number + a 6-digit PIN.
 * The number is saved on their profile (PATCH /partners/me), the PIN set with
 * POST /partners/me/pin, and the login is POST /auth/partner/phone-pin.
 */
const TEST_PARTNER_PASSWORD = "supersecret"
const PIN = "482913"

jest.setTimeout(90 * 1000)

async function createPartner(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-phone-${unique}@medusa-test.com`
  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  const partnerRes = await api.post(
    "/partners",
    {
      name: `Phone Partner ${unique}`,
      handle: `phonepartner-${unique}`,
      admin: { email, first_name: "Phone", last_name: "Admin" },
    },
    { headers: { Authorization: `Bearer ${login1.data.token}` } }
  )
  const login2 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  return {
    email,
    partnerId: partnerRes.data.partner.id as string,
    headers: { Authorization: `Bearer ${login2.data.token}` },
  }
}

const phoneLogin = (api: any, phone: string, pin: string) =>
  api.post("/auth/partner/phone-pin", { phone, pin }).catch((e: any) => e.response)

setupSharedTestSuite(({ api, getContainer }) => {
  describe("Partner phone + PIN login", () => {
    it("logs a partner admin in with their saved number and PIN, as the same admin", async () => {
      const partner = await createPartner(api)

      const saved = await api.patch(
        "/partners/me",
        { phone: "+91 98765 43210" },
        { headers: partner.headers }
      )
      expect(saved.data.admin.phone).toBe("+919876543210")

      const before = await api.get("/partners/me/pin", { headers: partner.headers })
      expect(before.data).toEqual({ phone: "+919876543210", pin_set: false, pin_set_at: null })

      // No PIN yet → no phone login.
      expect((await phoneLogin(api, "+919876543210", PIN)).status).toBe(401)

      const set = await api.post("/partners/me/pin", { pin: PIN }, { headers: partner.headers })
      expect(set.data).toEqual({ phone: "+919876543210", pin_set: true })

      // Typed the way a partner would, without +91.
      const login = await phoneLogin(api, "98765 43210", PIN)
      expect(login.status).toBe(200)
      expect(login.data.token).toBeTruthy()

      const me = await api.get("/partners/me", {
        headers: { Authorization: `Bearer ${login.data.token}` },
      })
      expect(me.data.partner_id).toBe(partner.partnerId)
      expect(me.data.admin.email).toBe(partner.email)
    })

    it("refuses a wrong PIN, and locks the number after 5", async () => {
      const partner = await createPartner(api)
      await api.patch("/partners/me", { phone: "+91 91234 56780" }, { headers: partner.headers })
      await api.post("/partners/me/pin", { pin: PIN }, { headers: partner.headers })

      for (let i = 0; i < 5; i++) {
        expect((await phoneLogin(api, "+919123456780", "111222")).status).toBe(401)
      }
      const locked = await phoneLogin(api, "+919123456780", PIN)
      expect(locked.status).toBe(401)
      expect(locked.data.message).toMatch(/Too many wrong PINs/)

      // Setting the PIN again (logged in by email) clears the lock.
      await api.post("/partners/me/pin", { pin: "730215" }, { headers: partner.headers })
      expect((await phoneLogin(api, "+919123456780", "730215")).status).toBe(200)
    })

    it("refuses a weak PIN, and a PIN before any phone is saved", async () => {
      const partner = await createPartner(api)
      const noPhone = await api
        .post("/partners/me/pin", { pin: PIN }, { headers: partner.headers })
        .catch((e: any) => e.response)
      expect(noPhone.status).toBe(400)
      expect(noPhone.data.message).toMatch(/phone number/i)

      await api.patch("/partners/me", { phone: "+91 90000 33333" }, { headers: partner.headers })
      const weak = await api
        .post("/partners/me/pin", { pin: "123456" }, { headers: partner.headers })
        .catch((e: any) => e.response)
      expect(weak.status).toBe(400)
    })

    it("refuses phone sign-up (login only)", async () => {
      const res = await api
        .post("/auth/partner/phone-pin/register", { phone: "+919000000001", pin: PIN })
        .catch((e: any) => e.response)
      expect(res.status).toBe(401)
    })

    it("refuses a second admin saving a number another login already uses", async () => {
      const first = await createPartner(api)
      const second = await createPartner(api)
      await api.patch("/partners/me", { phone: "+91 99887 76655" }, { headers: first.headers })

      const clash = await api
        .patch("/partners/me", { phone: "9988776655" }, { headers: second.headers })
        .catch((e: any) => e.response)
      expect(clash.status).toBeGreaterThanOrEqual(400)
      expect(clash.status).toBeLessThan(500)

      const me = await api.get("/partners/me", { headers: second.headers })
      expect(me.data.admin.phone ?? null).toBeNull()
    })

    it("keeps the PIN when the number changes, and removes phone login when cleared", async () => {
      const partner = await createPartner(api)
      await api.patch("/partners/me", { phone: "+91 90000 11111" }, { headers: partner.headers })
      await api.post("/partners/me/pin", { pin: PIN }, { headers: partner.headers })
      await api.patch("/partners/me", { phone: "+91 90000 22222" }, { headers: partner.headers })

      expect((await phoneLogin(api, "+919000011111", PIN)).status).toBe(401)
      expect((await phoneLogin(api, "+919000022222", PIN)).status).toBe(200)

      await api.patch("/partners/me", { phone: null }, { headers: partner.headers })
      expect((await phoneLogin(api, "+919000022222", PIN)).status).toBe(401)
    })

    it("keeps email login working for partners and our admin users", async () => {
      const partner = await createPartner(api)
      const login = await api.post("/auth/partner/emailpass", {
        email: partner.email,
        password: TEST_PARTNER_PASSWORD,
      })
      expect(login.data.token).toBeTruthy()

      await createAdminUser(getContainer())
      const adminHeaders = await getAuthHeaders(api)
      const me = await api.get("/admin/users/me", adminHeaders)
      expect(me.status).toBe(200)
    })
  })
})
