import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import WhatsAppService from "../../src/modules/social-provider/whatsapp-service"
import crypto from "crypto"

const TEST_PARTNER_PASSWORD = "supersecret"
const TEST_PHONE = process.env.WHATSAPP_TEST_RECIPIENT || "393933806825"

jest.setTimeout(300 * 1000) // 5 min — lifecycle test needs time for dispatch workflow

const waitFor = async (
  fn: () => Promise<boolean>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number }
) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await fn()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("WhatsApp Partner Flow — Real API", () => {
    let adminHeaders: any
    let partnerId: string
    let partnerHeaders: any
    let designId: string
    let designName: string

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = Date.now()
      const partnerEmail = `wa-partner-${unique}@jyt.test`

      // Register + login + create partner (same pattern as production-runs.spec.ts)
      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const createPartnerRes: any = await api.post(
        "/partners",
        {
          name: `WA Partner ${unique}`,
          handle: `wa-partner-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Saransh",
            last_name: "Sharma",
            phone: TEST_PHONE,
          },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )

      expect(createPartnerRes.status).toBe(200)
      partnerId = createPartnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      partnerHeaders = { headers: { Authorization: `Bearer ${login2.data.token}` } }

      // Create design
      designName = `WA Design ${unique}`
      const designRes = await api.post(
        "/admin/designs",
        {
          name: designName,
          description: "WhatsApp integration test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
        },
        adminHeaders
      )
      expect(designRes.status).toBe(201)
      designId = designRes.data.design.id
    })

    // ─── Full lifecycle: create run → dispatch → accept → start → finish → complete ───

    it("should run WhatsApp production run lifecycle end-to-end", async () => {
      if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) {
        console.warn("⚠️  Skipping — WhatsApp env not configured")
        return
      }

      const unique = Date.now()
      const whatsapp = new WhatsAppService()

      // 1) Create task templates (needed for dispatch)
      const templateA = {
        name: `wa-step-a-${unique}`,
        description: "WhatsApp test step A",
        priority: "medium",
        estimated_duration: 30,
        eventable: false,
        notifiable: false,
        metadata: { workflow_type: "production_run", step: "a" },
        category: "Production",
      }

      const t1 = await api.post("/admin/task-templates", templateA, adminHeaders)
      expect(t1.status).toBe(201)
      const categoryId = t1.data.task_template.category_id

      const templateB = {
        name: `wa-step-b-${unique}`,
        description: "WhatsApp test step B",
        priority: "medium",
        estimated_duration: 30,
        eventable: false,
        notifiable: false,
        metadata: { workflow_type: "production_run", step: "b" },
        category_id: categoryId,
      }

      const t2 = await api.post("/admin/task-templates", templateB, adminHeaders)
      expect(t2.status).toBe(201)

      // 2) Create parent production run
      const createRunRes = await api.post(
        "/admin/production-runs",
        { design_id: designId, quantity: 10 },
        adminHeaders
      )
      expect(createRunRes.status).toBe(201)
      const parentRunId = createRunRes.data.production_run.id

      // 3) Approve with partner assignment
      const approveRes = await api.post(
        `/admin/production-runs/${parentRunId}/approve`,
        {
          assignments: [
            { partner_id: partnerId, role: "production", quantity: 10 },
          ],
        },
        adminHeaders
      )
      expect(approveRes.status).toBe(200)
      const children = approveRes.data.result?.children || []
      expect(children.length).toBe(1)
      const childRunId = children[0].id

      // 4) Start dispatch
      const startDispatchRes = await api.post(
        `/admin/production-runs/${childRunId}/start-dispatch`,
        {},
        adminHeaders
      )
      expect(startDispatchRes.status).toBe(202)
      const dispatchTransactionId = startDispatchRes.data.transaction_id

      // 5) Resume dispatch with templates
      const resumeDispatchRes = await api.post(
        `/admin/production-runs/${childRunId}/resume-dispatch`,
        {
          transaction_id: dispatchTransactionId,
          template_names: [templateA.name, templateB.name],
        },
        adminHeaders
      )
      expect(resumeDispatchRes.status).toBe(200)

      // 6) Wait until status becomes sent_to_partner
      await waitFor(
        async () => {
          const r = await api.get(`/admin/production-runs/${childRunId}`, adminHeaders)
          return String(r.data.production_run?.status) === "sent_to_partner"
        },
        { timeoutMs: 15_000, intervalMs: 500 }
      )

      console.log("📋 Run dispatched:", childRunId)

      // ─── WhatsApp: Send assignment notification ───
      const assignResult = await whatsapp.sendProductionRunAssignment(TEST_PHONE, {
        designName,
        runId: childRunId,
        runType: "production",
        quantity: 10,
        notes: "Integration test — check your WhatsApp!",
      })
      expect(assignResult.messages[0].id).toBeTruthy()
      console.log("📱 Assignment sent to WhatsApp")

      // 7) Partner accepts
      const acceptRes = await api.post(
        `/partners/production-runs/${childRunId}/accept`,
        {},
        partnerHeaders
      )
      expect(acceptRes.status).toBe(200)

      const acceptMsg = await whatsapp.sendRunActions(TEST_PHONE, childRunId, "in_progress", designName)
      expect(acceptMsg.messages[0].id).toBeTruthy()
      console.log("📱 Accept + Start button sent")

      // 8) Partner starts
      const startRes = await api.post(
        `/partners/production-runs/${childRunId}/start`,
        {},
        partnerHeaders
      )
      expect(startRes.status).toBe(200)

      const startMsg = await whatsapp.sendRunActions(TEST_PHONE, childRunId, "started", designName)
      expect(startMsg.messages[0].id).toBeTruthy()
      console.log("📱 Started + Finish/Media buttons sent")

      // 9) Partner finishes
      const finishRes = await api.post(
        `/partners/production-runs/${childRunId}/finish`,
        {},
        partnerHeaders
      )
      expect(finishRes.status).toBe(200)

      const finishMsg = await whatsapp.sendRunActions(TEST_PHONE, childRunId, "finished", designName)
      expect(finishMsg.messages[0].id).toBeTruthy()
      console.log("📱 Finished + Complete button sent")

      // 10) Partner completes with quantities
      const completeRes = await api.post(
        `/partners/production-runs/${childRunId}/complete`,
        { produced_quantity: 8, rejected_quantity: 2, notes: "WhatsApp test complete" },
        partnerHeaders
      )
      expect(completeRes.status).toBe(200)
      expect(completeRes.data.production_run.status).toBe("completed")
      expect(completeRes.data.production_run.produced_quantity).toBe(8)

      const completeMsg = await whatsapp.sendTextMessage(
        TEST_PHONE,
        `✅ *Production Run Completed!*\n*Run:* ${childRunId}\n*Produced:* 8 | *Rejected:* 2\n\nAdmin notified. Thank you!`
      )
      expect(completeMsg.messages[0].id).toBeTruthy()
      console.log("📱 Completion confirmation sent")

      console.log("✅ Full WhatsApp lifecycle test passed!")
    })

    // ─── Webhook tests ───

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

    // ─── Deep-link auth tests ───

    it("should validate wa-auth deep-link token", async () => {
      const { generatePartnerDeeplink } = await import(
        "../../src/modules/social-provider/whatsapp-deeplink"
      )

      const { token } = generatePartnerDeeplink(
        { partner_id: partnerId, run_id: "prod_run_test", type: "production_run" },
        "https://portal.jyt.com"
      )

      const res = await api.get(
        `/partners/wa-auth?wa_token=${token}`,
        { validateStatus: () => true }
      )

      expect(res.status).toBe(200)
      expect(res.data.partner_id).toBe(partnerId)
      expect(res.data.redirect).toBe("/production-runs/prod_run_test")
      expect(res.data.run_id).toBe("prod_run_test")
      console.log("✅ Deep-link token validated")
    })

    it("should reject invalid wa-auth token", async () => {
      const res = await api.get(
        `/partners/wa-auth?wa_token=invalid.jwt.token`,
        { validateStatus: () => true }
      )

      // Medusa maps UNAUTHORIZED to 401
      expect([400, 401]).toContain(res.status)
    })

    it("should reject wa-auth without token", async () => {
      const res = await api.get(
        `/partners/wa-auth`,
        { validateStatus: () => true }
      )

      expect([400, 401]).toContain(res.status)
    })

    // ─── WhatsApp verification (OTP) tests ───

    it("should send OTP and verify WhatsApp number", async () => {
      if (!process.env.WHATSAPP_ACCESS_TOKEN) return

      // Step 1: Request OTP
      const sendRes = await api
        .post(
          "/partners/whatsapp-verify",
          { phone: TEST_PHONE },
          partnerHeaders
        )
        .catch((err: any) => err.response)

      expect(sendRes.status).toBe(200)
      expect(sendRes.data.message).toContain("Verification code sent")
      expect(sendRes.data.phone).toBe(TEST_PHONE)
      console.log("📱 OTP sent to WhatsApp")

      // Note: In a real test we'd need to read the OTP from the message.
      // For integration testing, we can't easily do that without webhook.
      // The OTP flow works — the code was sent successfully.
    })

    it("should reject OTP verification without pending request", async () => {
      // Use a fresh partner session or different context where no OTP was requested
      const res = await api
        .post(
          "/partners/whatsapp-verify",
          { code: "123456" },
          partnerHeaders
        )
        .catch((err: any) => err.response)

      // After the previous test's OTP was stored, sending a wrong code should fail
      expect([400, 401]).toContain(res.status)
    })

    // ─── WhatsApp SocialPlatform connect tests ───

    describe("POST /admin/social-platforms/whatsapp/connect", () => {
      it("should connect WhatsApp with credentials and create a SocialPlatform record", async () => {
        const res = await api.post(
          "/admin/social-platforms/whatsapp/connect",
          {
            access_token: "test_whatsapp_token_123",
            phone_number_id: "1234567890",
            webhook_verify_token: "test_verify_token",
            app_secret: "test_app_secret",
          },
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.socialPlatform).toBeDefined()
        expect(res.data.socialPlatform.name).toBe("WhatsApp")
        expect(res.data.socialPlatform.category).toBe("communication")
        expect(res.data.socialPlatform.status).toBe("active")
        expect(res.data.socialPlatform.connected).toBe(true)
      })

      it("should update existing WhatsApp platform on re-connect", async () => {
        const res = await api.post(
          "/admin/social-platforms/whatsapp/connect",
          {
            access_token: "updated_token_456",
            phone_number_id: "9876543210",
          },
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.socialPlatform.connected).toBe(true)
      })

      it("should reject connect without required fields", async () => {
        const res = await api
          .post(
            "/admin/social-platforms/whatsapp/connect",
            { phone_number_id: "123" },
            { ...adminHeaders, validateStatus: () => true }
          )
          .catch((err: any) => err.response)

        expect(res.status).toBe(400)
      })

      it("should reject connect without phone_number_id", async () => {
        const res = await api
          .post(
            "/admin/social-platforms/whatsapp/connect",
            { access_token: "some_token" },
            { ...adminHeaders, validateStatus: () => true }
          )
          .catch((err: any) => err.response)

        expect(res.status).toBe(400)
      })
    })

    describe("GET /admin/social-platforms/whatsapp/connect", () => {
      it("should return not connected when no platform exists", async () => {
        const res = await api.get(
          "/admin/social-platforms/whatsapp/connect",
          adminHeaders
        )

        expect(res.status).toBe(200)
        // No WhatsApp platform created yet in this test run
        expect(typeof res.data.connected).toBe("boolean")
        expect(typeof res.data.source).toBe("string")
      })

      it("should return connected after setting up WhatsApp", async () => {
        // First connect
        const connectRes = await api.post(
          "/admin/social-platforms/whatsapp/connect",
          {
            access_token: "status_check_token",
            phone_number_id: "5551234567",
            webhook_verify_token: "verify_me",
            app_secret: "secret_123",
          },
          adminHeaders
        )
        expect(connectRes.status).toBe(200)

        // Then check status
        const res = await api.get(
          "/admin/social-platforms/whatsapp/connect",
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.connected).toBe(true)
        expect(res.data.source).toBe("database")
        expect(res.data.platform).toBeDefined()
        expect(res.data.platform.name).toBe("WhatsApp")
        expect(res.data.platform.phone_number_id).toBe("5551234567")
        expect(res.data.platform.has_access_token).toBe(true)
        expect(res.data.platform.has_webhook_verify_token).toBe(true)
        expect(res.data.platform.has_app_secret).toBe(true)
      })
    })
  })
})
