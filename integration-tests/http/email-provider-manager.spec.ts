import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(30000)

setupSharedTestSuite(() => {
  let headers

  beforeEach(async () => {
    const { api, getContainer } = getSharedTestEnv()
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  describe("Email Provider Manager - Load Distribution", () => {
    it("should return provider capacity via GET /admin/email-providers", async () => {
      const { api } = getSharedTestEnv()

      const response = await api.get("/admin/email-providers", headers)

      expect(response.status).toBe(200)
      expect(response.data).toHaveProperty("providers")
      expect(response.data).toHaveProperty("total_remaining")
      expect(response.data).toHaveProperty("total_daily_limit")

      // Should have both providers configured
      const { providers, total_daily_limit } = response.data
      expect(providers).toBeInstanceOf(Array)
      expect(providers.length).toBe(2)

      // Verify mailjet provider (200/day)
      const mailjet = providers.find((p) => p.provider === "mailjet")
      expect(mailjet).toBeDefined()
      expect(mailjet.limit).toBe(200)
      expect(mailjet.remaining).toBe(200) // Fresh day, no usage
      expect(mailjet.used).toBe(0)

      // Verify resend provider (100/day)
      const resend = providers.find((p) => p.provider === "resend")
      expect(resend).toBeDefined()
      expect(resend.limit).toBe(100)
      expect(resend.remaining).toBe(100)
      expect(resend.used).toBe(0)

      // Total should be 300
      expect(total_daily_limit).toBe(300)
    })

    it("should distribute emails across providers based on capacity", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Generate 250 test email addresses
      const emails = Array.from({ length: 250 }, (_, i) => `test${i}@example.com`)

      const allocations = await providerManager.distributeEmails(emails)

      // Should have allocations for both providers
      expect(allocations.length).toBe(2)

      // Mailjet gets first 200 (higher capacity, sorted first)
      const mailjetAlloc = allocations.find((a) => a.provider === "mailjet")
      expect(mailjetAlloc).toBeDefined()
      expect(mailjetAlloc.emails.length).toBe(200)

      // Resend gets remaining 50
      const resendAlloc = allocations.find((a) => a.provider === "resend")
      expect(resendAlloc).toBeDefined()
      expect(resendAlloc.emails.length).toBe(50)

      // All emails should be accounted for
      const totalAllocated =
        mailjetAlloc.emails.length + resendAlloc.emails.length
      expect(totalAllocated).toBe(250)
    })

    it("should distribute only to mailjet when under 200 emails", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Generate 150 test emails - fits within mailjet alone
      const emails = Array.from({ length: 150 }, (_, i) => `small${i}@example.com`)

      const allocations = await providerManager.distributeEmails(emails)

      // Mailjet has highest capacity (200), should get all 150
      const mailjetAlloc = allocations.find((a) => a.provider === "mailjet")
      expect(mailjetAlloc).toBeDefined()
      expect(mailjetAlloc.emails.length).toBe(150)

      // Resend should either not appear or have 0 emails
      const resendAlloc = allocations.find((a) => a.provider === "resend")
      if (resendAlloc) {
        expect(resendAlloc.emails.length).toBe(0)
      }
    })

    it("should handle overflow when total exceeds 300 emails", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Generate 350 emails - exceeds total capacity
      const emails = Array.from({ length: 350 }, (_, i) => `overflow${i}@example.com`)

      const allocations = await providerManager.distributeEmails(emails)

      // All emails should still be allocated (overflow goes to first provider)
      const totalAllocated = allocations.reduce(
        (sum, a) => sum + a.emails.length,
        0
      )
      expect(totalAllocated).toBe(350)
    })

    it("should track usage and reduce remaining capacity", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Record 50 sends via mailjet
      await providerManager.recordUsage("mailjet", 50)

      // Check remaining capacity
      const capacities = await providerManager.getRemainingCapacity()

      const mailjet = capacities.find((c) => c.provider === "mailjet")
      expect(mailjet.used).toBe(50)
      expect(mailjet.remaining).toBe(150) // 200 - 50

      const resend = capacities.find((c) => c.provider === "resend")
      expect(resend.used).toBe(0)
      expect(resend.remaining).toBe(100)
    })

    it("should adjust distribution after recording usage", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Simulate mailjet already used 180 today
      await providerManager.recordUsage("mailjet", 180)

      // Now distribute 50 emails
      const emails = Array.from({ length: 50 }, (_, i) => `adjusted${i}@example.com`)

      const allocations = await providerManager.distributeEmails(emails)

      // Resend has 100 remaining, mailjet has only 20 remaining
      // Resend should get more since it has higher remaining capacity
      const resendAlloc = allocations.find((a) => a.provider === "resend")
      const mailjetAlloc = allocations.find((a) => a.provider === "mailjet")

      // Resend (100 remaining) > Mailjet (20 remaining), so resend gets first batch
      expect(resendAlloc).toBeDefined()
      expect(resendAlloc.emails.length).toBe(50) // All 50 fit in resend's 100

      // Mailjet might not get any since resend can handle all 50
      if (mailjetAlloc) {
        expect(mailjetAlloc.emails.length).toBe(0)
      }
    })

    it("should accumulate usage with multiple recordUsage calls", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Record usage in multiple batches
      await providerManager.recordUsage("resend", 30)
      await providerManager.recordUsage("resend", 20)
      await providerManager.recordUsage("resend", 10)

      const usage = await providerManager.getProviderUsage("resend")
      expect(usage).toBe(60) // 30 + 20 + 10

      const capacities = await providerManager.getRemainingCapacity()
      const resend = capacities.find((c) => c.provider === "resend")
      expect(resend.remaining).toBe(40) // 100 - 60
    })

    it("should return correct total remaining capacity", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // No usage yet - should be 300
      const total = await providerManager.getTotalRemainingCapacity()
      expect(total).toBe(300)

      // Record some usage
      await providerManager.recordUsage("mailjet", 100)
      await providerManager.recordUsage("resend", 25)

      const totalAfter = await providerManager.getTotalRemainingCapacity()
      expect(totalAfter).toBe(175) // 300 - 100 - 25
    })

    it("should expose provider configs", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      const configs = providerManager.getProviderConfigs()

      expect(configs).toEqual([
        { id: "mailjet", daily_limit: 200 },
        { id: "resend", daily_limit: 100 },
      ])
    })

    it("should allow updating provider limits at runtime", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Upgrade resend plan
      providerManager.setProviderLimit("resend", 500)

      const configs = providerManager.getProviderConfigs()
      const resend = configs.find((c) => c.id === "resend")
      expect(resend.daily_limit).toBe(500)

      // Capacity should reflect new limit
      const capacities = await providerManager.getRemainingCapacity()
      const resendCap = capacities.find((c) => c.provider === "resend")
      expect(resendCap.limit).toBe(500)
      expect(resendCap.remaining).toBe(500)

      // Reset for other tests
      providerManager.setProviderLimit("resend", 100)
    })
  })
})
