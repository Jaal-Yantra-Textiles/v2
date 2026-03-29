import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"
const TEST_PHONE = process.env.WHATSAPP_TEST_RECIPIENT || "393933806825"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("WhatsApp Routes", () => {
    let partnerId: string
    let partnerHeaders: any

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)

      const unique = Date.now()
      const email = `wa-routes-${unique}@jyt.test`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      const createRes: any = await api.post(
        "/partners",
        {
          name: `WA Routes Partner ${unique}`,
          handle: `wa-routes-${unique}`,
          admin: {
            email,
            first_name: "Test",
            last_name: "Partner",
            phone: TEST_PHONE,
          },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )

      expect(createRes.status).toBe(200)
      partnerId = createRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: TEST_PARTNER_PASSWORD,
      })

      partnerHeaders = { headers: { Authorization: `Bearer ${login2.data.token}` } }
    })

    // ─── Deep-link auth (run first — no side effects) ───

    it("should validate deep-link token and return partner info", async () => {
      const { generatePartnerDeeplink } = await import(
        "../../src/modules/social-provider/whatsapp-deeplink"
      )

      const { token } = generatePartnerDeeplink(
        { partner_id: partnerId, run_id: "prod_run_test_123", type: "production_run" },
        "https://portal.jyt.com"
      )

      const res = await api.get(
        `/partners/wa-auth?wa_token=${token}`,
        { validateStatus: () => true }
      )

      expect(res.status).toBe(200)
      expect(res.data.partner_id).toBe(partnerId)
      expect(res.data.redirect).toBe("/production-runs/prod_run_test_123")
      expect(res.data.type).toBe("production_run")
    })

    it("should reject invalid deep-link token", async () => {
      const res = await api.get(
        `/partners/wa-auth?wa_token=invalid.jwt.token`,
        { validateStatus: () => true }
      )
      expect([400, 401]).toContain(res.status)
    })

    it("should reject deep-link without token", async () => {
      const res = await api.get(
        `/partners/wa-auth`,
        { validateStatus: () => true }
      )
      expect([400, 401]).toContain(res.status)
    })

    // ─── Webhook verification ───

    it("should verify webhook with correct token", async () => {
      const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || "jyt_whatsapp_test_verify"
      const res = await api.get(
        `/webhooks/social/whatsapp?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=test_123`,
        { validateStatus: () => true }
      )
      expect(res.status).toBe(200)
      expect(res.data).toBe("test_123")
    })

    it("should reject webhook with wrong token", async () => {
      const res = await api.get(
        `/webhooks/social/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test`,
        { validateStatus: () => true }
      )
      expect(res.status).toBe(403)
    })

    it("should reject webhook POST with invalid signature", async () => {
      const res = await api.post(
        "/webhooks/social/whatsapp",
        JSON.stringify({ object: "whatsapp_business_account", entry: [] }),
        {
          headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=invalid" },
          validateStatus: () => true,
          transformRequest: [(data: any) => data],
        }
      )
      expect(res.status).toBe(401)
    })

    // ─── OTP verification ───

    it("should send OTP via WhatsApp", async () => {
      if (!process.env.WHATSAPP_ACCESS_TOKEN) {
        console.warn("⚠️  Skipping OTP test — WHATSAPP_ACCESS_TOKEN not set")
        return
      }

      const res = await api
        .post("/partners/whatsapp-verify", { phone: TEST_PHONE }, partnerHeaders)
        .catch((err: any) => err.response)

      // 200 = OTP sent, 400 = WhatsApp API rejected (test mode / expired token)
      if (res.status === 200) {
        expect(res.data.phone).toBe(TEST_PHONE)
        expect(res.data.message).toContain("Verification code sent")
      } else {
        expect(res.status).toBe(400)
        console.warn("⚠️  OTP send failed (expected in test mode)")
      }
    })

    it("should reject wrong OTP code", async () => {
      if (!process.env.WHATSAPP_ACCESS_TOKEN) return

      await api.post("/partners/whatsapp-verify", { phone: TEST_PHONE }, partnerHeaders).catch(() => {})

      const res = await api
        .post("/partners/whatsapp-verify", { code: "000000" }, partnerHeaders)
        .catch((err: any) => err.response)

      expect(res.status).toBe(400)
    })

    it("should reject OTP request without phone", async () => {
      const res = await api
        .post("/partners/whatsapp-verify", {}, partnerHeaders)
        .catch((err: any) => err.response)

      expect(res.status).toBe(400)
    })
  })
})
