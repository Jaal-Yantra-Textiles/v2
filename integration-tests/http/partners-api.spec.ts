import { medusaIntegrationTestRunner } from "@medusajs/test-utils"

const TEST_PARTNER_EMAIL = "admin@medusa-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"

medusaIntegrationTestRunner({
    testSuite: ({ api }) => {
        let partnerHeaders: Record<string, string>

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
    },
})
