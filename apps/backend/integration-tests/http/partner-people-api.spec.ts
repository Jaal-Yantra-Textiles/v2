import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

const TEST_PARTNER_EMAIL = "admin@medusa-test.com"
const TEST_PARTNER_PASSWORD = "supersecret"
jest.setTimeout(60 * 1000);
setupSharedTestSuite(() => {
        let partnerHeaders: Record<string, string>
        let partnerId: string
        const { api } = getSharedTestEnv();
        beforeEach(async () => {
            // Register partner admin
            await api.post("/auth/partner/emailpass/register", {
                email: TEST_PARTNER_EMAIL,
                password: TEST_PARTNER_PASSWORD,
            })

            // Login to get token
            const authResponse = await api.post("/auth/partner/emailpass", {
                email: TEST_PARTNER_EMAIL,
                password: TEST_PARTNER_PASSWORD,
            })

            // Get the token from the response
            const token = authResponse.data.token

            // Set up headers with the token
            partnerHeaders = {
                Authorization: `Bearer ${token}`,
            }

            // Create a partner with the authenticated admin
            const partnerResponse = await api.post(
                "/partners",
                {
                    name: "Acme",
                    handle: "acme",
                    admin: {
                        email: TEST_PARTNER_EMAIL,
                        first_name: "Admin",
                        last_name: "Acme",
                    },
                },
                { 
                    headers: {
                        Authorization: `Bearer ${token}`,
                    }
                }
            )

            partnerId = partnerResponse.data.partner.id

            // Get fresh token after partner creation
            const newAuthResponse = await api.post("/auth/partner/emailpass", {
                email: TEST_PARTNER_EMAIL,
                password: TEST_PARTNER_PASSWORD,
            })

            // Update headers with new token
            partnerHeaders = {
                Authorization: `Bearer ${newAuthResponse.data.token}`,
            }
        })

        describe("Partner People Management", () => {
            test("should add people to partner successfully", async () => {
                const people = [
                    {
                        first_name: "John",
                        last_name: "Doe",
                        email: "john@example.com",
                    },
                    {
                        first_name: "Jane",
                        last_name: "Smith",
                        email: "jane@example.com",
                    },
                ]

                // Log the request details for debugging
                console.log("Request URL:", `/partners/${partnerId}`)
                console.log("Request Headers:", partnerHeaders)
                console.log("Request Body:", { people })

                const response = await api.post(
                    `/partners/${partnerId}`,
                    { people },
                    { headers: partnerHeaders }
                ).catch(error => {
                    console.error("Error Response:", error.response?.data)
                    throw error
                })

                expect(response.status).toBe(200)
                expect(response.data.partner).toBeDefined()
                expect(response.data.partner.people).toHaveLength(2)
                expect(response.data.partner.people[0].email).toBe("john@example.com")
                expect(response.data.partner.people[1].email).toBe("jane@example.com")
            })

            test("should get partner people successfully", async () => {
                const response = await api.get(
                    `/partners/${partnerId}`,
                    { headers: partnerHeaders }
                ).catch(error => {
                    console.error("Error Response:", error.response?.data)
                    throw error
                })

                expect(response.status).toBe(200)
                expect(response.data.partner).toBeDefined()
                expect(response.data.partner.people).toBeDefined()
                expect(Array.isArray(response.data.partner.people)).toBe(true)
            })

            test("should handle invalid people data", async () => {
                const invalidPeople = [
                    {
                        // Missing required first_name
                        last_name: "Doe",
                        email: "john@example.com",
                    },
                ]

                await expect(
                    api.post(
                        `/partners/${partnerId}`,
                        { people: invalidPeople },
                        { headers: partnerHeaders }
                    )
                ).rejects.toThrow()
            })
        })
})
