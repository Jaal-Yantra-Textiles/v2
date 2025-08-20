import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

const TEST_PARTNER_EMAIL = "admin@medusa-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"
jest.setTimeout(60 * 1000);
setupSharedTestSuite(() => {
        let partnerHeaders: Record<string, string>
        const { api } = getSharedTestEnv();
        beforeEach(async () => {
            // Register partner admin
            await api.post("/auth/partner/emailpass/register", {
                email: TEST_PARTNER_EMAIL,
                password: TEST_PARTNER_PASSWORD,
            })

            // Login to get token
            const response = await api.post("/auth/partner/emailpass", {
                email: TEST_PARTNER_EMAIL,
                password: TEST_PARTNER_PASSWORD,
            })

            partnerHeaders = {
                Authorization: `Bearer ${response.data.token}`,
            }
        })

        describe("Partner Creation", () => {
            test("should create a partner successfully", async () => {
                const newPartner = {
                    name: "Acme",
                    handle: "acme",
                    admin: {
                        email: TEST_PARTNER_EMAIL,
                        first_name: "Admin",
                        last_name: "Acme",
                    },
                }

                const response = await api.post(
                    "/partners",
                    newPartner,
                    { headers: partnerHeaders }
                )

                expect(response.status).toBe(200)
                expect(response.data.partner).toBeDefined()
                expect(response.data.partner.name).toBe(newPartner.name)
                expect(response.data.partner.handle).toBe(newPartner.handle)
                expect(response.data.partner.admins).toHaveLength(1)
                expect(response.data.partner.admins[0].email).toBe(TEST_PARTNER_EMAIL)
                expect(response.data.partner.admins[0].first_name).toBe(newPartner.admin.first_name)
                expect(response.data.partner.admins[0].last_name).toBe(newPartner.admin.last_name)
            })

            test("should not allow creating duplicate partners for same admin", async () => {
                const newPartner = {
                    name: "Acme 2",
                    handle: "acme-2",
                    admin: {
                        email: TEST_PARTNER_EMAIL,
                        first_name: "Admin",
                        last_name: "Acme",
                    },
                }
                const duplicate = {
                    name: "Acme 2",
                    handle: "acme-2",
                    admin: {
                        email: TEST_PARTNER_EMAIL,
                        first_name: "Admin",
                        last_name: "Acme",
                    },
                }
                const response = await api.post(
                    "/partners",
                    newPartner,
                    { headers: partnerHeaders }
                )
                const duplicateResponse = await api.post(
                    "/partners",
                    duplicate,
                    { headers: partnerHeaders }
                ).catch((err) => err.response).then(res => {
                    expect(res.status).toBe(400)
                    expect(res.data.message).toBe("A partner with handle \"acme-2\" already exists. Please use a unique handle.")
                })
            })
        })

        describe("Partner Payments APIs", () => {
          let partnerHeaders: Record<string, string>
          let partnerId: string
          const { api } = getSharedTestEnv()

          beforeEach(async () => {
            // Use a unique email per test run to avoid conflicts
            const unique = Date.now()
            const EMAIL = `partner-${unique}@medusa-test.com`
            const PASSWORD = "supersecret"

            // 1) Register partner admin
            await api.post("/auth/partner/emailpass/register", {
              email: EMAIL,
              password: PASSWORD,
            })

            // 2) Login to get initial token
            const login1 = await api.post("/auth/partner/emailpass", {
              email: EMAIL,
              password: PASSWORD,
            })
            partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

            // 3) Create partner with unique handle
            const newPartner = {
              name: `Acme ${unique}`,
              handle: `acme-${unique}`,
              admin: {
                email: EMAIL,
                first_name: "Admin",
                last_name: "Acme",
              },
            }

            const createRes = await api.post("/partners", newPartner, { headers: partnerHeaders })
            partnerId = createRes.data.partner.id

            // 4) IMPORTANT: Get a fresh token after partner creation (auth context updated)
            const login2 = await api.post("/auth/partner/emailpass", {
              email: EMAIL,
              password: PASSWORD,
            })
            partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }
          })

          test("should list 0 payment methods, create one, then list 1", async () => {
            // Initially no methods
            const list0 = await api.get(`/partners/${partnerId}/payments/methods`, { headers: partnerHeaders })
            expect(list0.status).toBe(200)
            expect(Array.isArray(list0.data.paymentMethods)).toBe(true)
            expect(list0.data.paymentMethods.length).toBe(0)

            // Create a payment method
            const payload = {
              type: "bank_account",
              account_name: "ACME Corp",
              account_number: "1234567890",
              bank_name: "Medusa Bank",
              ifsc_code: "MEDU0001234",
              metadata: { note: "primary" },
            }

            const create = await api.post(
              `/partners/${partnerId}/payments/methods`,
              payload,
              { headers: partnerHeaders }
            )
            expect(create.status).toBe(201)
            expect(create.data.paymentMethod).toBeDefined()
            expect(create.data.paymentMethod.type).toBe(payload.type)

            // List again should show 1
            const list1 = await api.get(`/partners/${partnerId}/payments/methods`, { headers: partnerHeaders })
            expect(list1.status).toBe(200)
            expect(Array.isArray(list1.data.paymentMethods)).toBe(true)
            expect(list1.data.paymentMethods.length).toBe(1)
          })

          test("should list payments for partner (empty list is acceptable)", async () => {
            const res = await api.get(`/partners/${partnerId}/payments`, { headers: partnerHeaders })
            expect(res.status).toBe(200)
            expect(Array.isArray(res.data.payments)).toBe(true)
            expect(typeof res.data.count).toBe("number")
          })
        })
})
