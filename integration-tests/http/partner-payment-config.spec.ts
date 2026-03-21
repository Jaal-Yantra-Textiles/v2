import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner Payment Config API", () => {
    let partnerHeaders: Record<string, string>
    let partnerId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)

      const unique = Date.now()
      const partnerEmail = `partner-pay-${unique}@medusa-test.com`

      // Register + login
      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      // Create partner
      const createRes = await api.post(
        "/partners",
        {
          name: `Pay Test ${unique}`,
          handle: `pay-test-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Pay",
            last_name: "Tester",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = createRes.data.partner.id

      // Fresh token
      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }
    })

    it("should list empty payment configs initially", async () => {
      const res = await api.get("/partners/payment-config", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data.payment_configs).toEqual([])
    })

    it("should create a PayU payment config", async () => {
      const res = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "test_merchant_key_123",
            merchant_salt: "test_merchant_salt_456",
            mode: "test",
          },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(res.data.payment_config).toBeDefined()
      expect(res.data.payment_config.provider_id).toBe("pp_payu_payu")
      expect(res.data.payment_config.is_active).toBe(true)

      // Credentials should be masked in response
      expect(res.data.payment_config.credentials.merchant_key).toContain("****")
      expect(res.data.payment_config.credentials.merchant_salt).toContain("****")
    })

    it("should list payment configs after creation", async () => {
      // Create config
      await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "my_key_abc",
            merchant_salt: "my_salt_xyz",
            mode: "test",
          },
        },
        { headers: partnerHeaders }
      )

      // List
      const res = await api.get("/partners/payment-config", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data.payment_configs.length).toBe(1)
      expect(res.data.payment_configs[0].provider_id).toBe("pp_payu_payu")
    })

    it("should upsert: creating same provider updates existing config", async () => {
      // Create initial
      const first = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "old_key_111",
            merchant_salt: "old_salt_222",
            mode: "test",
          },
        },
        { headers: partnerHeaders }
      )

      // Create again with same provider — should update
      const second = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "new_key_333",
            merchant_salt: "new_salt_444",
            mode: "live",
          },
        },
        { headers: partnerHeaders }
      )

      expect(second.status).toBe(200) // 200 = updated, not 201

      // Should still have only one config
      const list = await api.get("/partners/payment-config", {
        headers: partnerHeaders,
      })
      expect(list.data.payment_configs.length).toBe(1)
    })

    it("should update a config by ID", async () => {
      // Create
      const created = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "key_to_update",
            merchant_salt: "salt_to_update",
            mode: "test",
          },
        },
        { headers: partnerHeaders }
      )

      const configId = created.data.payment_config.id

      // Update
      const updated = await api.post(
        `/partners/payment-config/${configId}`,
        {
          is_active: false,
        },
        { headers: partnerHeaders }
      )

      expect(updated.status).toBe(200)
      expect(updated.data.payment_config.is_active).toBe(false)
    })

    it("should delete a config by ID", async () => {
      // Create
      const created = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "key_to_delete",
            merchant_salt: "salt_to_delete",
          },
        },
        { headers: partnerHeaders }
      )

      const configId = created.data.payment_config.id

      // Delete
      const deleteRes = await api.delete(
        `/partners/payment-config/${configId}`,
        { headers: partnerHeaders }
      )

      expect(deleteRes.status).toBe(200)
      expect(deleteRes.data.deleted).toBe(true)

      // Should be gone
      const list = await api.get("/partners/payment-config", {
        headers: partnerHeaders,
      })
      expect(list.data.payment_configs.length).toBe(0)
    })

    it("should create a Stripe payment config", async () => {
      const res = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_stripe_stripe",
          credentials: {
            api_key: "sk_test_abc123def456",
          },
        },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(res.data.payment_config.provider_id).toBe("pp_stripe_stripe")
      // API key should be masked
      expect(res.data.payment_config.credentials.api_key).toContain("****")
    })

    it("should reject invalid provider_id", async () => {
      try {
        await api.post(
          "/partners/payment-config",
          {
            provider_id: "pp_invalid_provider",
            credentials: { key: "value" },
          },
          { headers: partnerHeaders }
        )
        fail("Should have thrown")
      } catch (e: any) {
        expect(e.response.status).toBe(400)
      }
    })

    it("should not allow access to another partner's config", async () => {
      // Create config as current partner
      const created = await api.post(
        "/partners/payment-config",
        {
          provider_id: "pp_payu_payu",
          credentials: {
            merchant_key: "partner1_key",
            merchant_salt: "partner1_salt",
          },
        },
        { headers: partnerHeaders }
      )

      const configId = created.data.payment_config.id

      // Create a second partner
      const unique2 = Date.now() + 1
      const email2 = `partner-pay2-${unique2}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email: email2,
        password: TEST_PARTNER_PASSWORD,
      })
      const login2 = await api.post("/auth/partner/emailpass", {
        email: email2,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers2 = { Authorization: `Bearer ${login2.data.token}` }

      await api.post(
        "/partners",
        {
          name: `Partner 2 ${unique2}`,
          handle: `partner2-${unique2}`,
          admin: { email: email2, first_name: "P2", last_name: "Test" },
        },
        { headers: headers2 }
      )

      const login2b = await api.post("/auth/partner/emailpass", {
        email: email2,
        password: TEST_PARTNER_PASSWORD,
      })
      const headers2b = { Authorization: `Bearer ${login2b.data.token}` }

      // Partner 2 should not see partner 1's config
      try {
        await api.get(`/partners/payment-config/${configId}`, {
          headers: headers2b,
        })
        fail("Should have thrown")
      } catch (e: any) {
        expect(e.response.status).toBe(404)
      }
    })
  })
})
