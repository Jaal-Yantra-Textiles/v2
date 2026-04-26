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
      expect(mailjet.remaining).toBe(200)
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

      const { allocations, overflow } = await providerManager.distributeEmails(emails)

      // No overflow — 250 fits within 300 capacity
      expect(overflow).toHaveLength(0)

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

      const { allocations, overflow } = await providerManager.distributeEmails(emails)

      expect(overflow).toHaveLength(0)

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

    it("should return overflow when total exceeds 300 emails", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Generate 350 emails - exceeds total capacity of 300
      const emails = Array.from({ length: 350 }, (_, i) => `overflow${i}@example.com`)

      const { allocations, overflow } = await providerManager.distributeEmails(emails)

      // Allocations should max out at 300
      const totalAllocated = allocations.reduce(
        (sum, a) => sum + a.emails.length,
        0
      )
      expect(totalAllocated).toBe(300)

      // 50 emails should be overflow
      expect(overflow).toHaveLength(50)

      // Overflow emails should be the last 50
      expect(overflow[0]).toBe("overflow300@example.com")
      expect(overflow[49]).toBe("overflow349@example.com")
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

      const { allocations, overflow } = await providerManager.distributeEmails(emails)

      expect(overflow).toHaveLength(0)

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

  describe("Email Provider Manager - Overflow Queue", () => {
    it("should queue overflow emails for the next day", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      const entries = [
        {
          to_email: "queued1@example.com",
          channel: "email",
          template: "d-blog-subscription-template",
          data: { subject: "Test Blog", blog_content: "<p>Hello</p>" },
        },
        {
          to_email: "queued2@example.com",
          channel: "email",
          template: "d-blog-subscription-template",
          data: { subject: "Test Blog", blog_content: "<p>Hello</p>" },
        },
      ]

      const count = await providerManager.queueOverflowEmails(entries)
      expect(count).toBe(2)

      // Verify queue entries were created
      const queued = await providerManager.listEmailQueues(
        { status: "pending" },
        { take: 10 }
      )

      expect(queued.length).toBeGreaterThanOrEqual(2)

      const first = queued.find((q) => q.to_email === "queued1@example.com")
      expect(first).toBeDefined()
      expect(first.status).toBe("pending")
      expect(first.channel).toBe("email")
      expect(first.template).toBe("d-blog-subscription-template")
      expect(first.attempts).toBe(0)

      // Data should be JSON-serialized
      const parsedData = JSON.parse(first.data)
      expect(parsedData.subject).toBe("Test Blog")
      expect(parsedData.blog_content).toBe("<p>Hello</p>")

      // scheduled_for should be tomorrow
      const tomorrow = providerManager.getNextDate()
      expect(first.scheduled_for).toBe(tomorrow)
    })

    it("should create queue entries with correct defaults", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      await providerManager.queueOverflowEmails([
        {
          to_email: "defaults@example.com",
          channel: "email_bulk",
          template: "my-template",
          data: { key: "value" },
        },
      ])

      const queued = await providerManager.listEmailQueues(
        { to_email: "defaults@example.com" },
        { take: 1 }
      )

      expect(queued.length).toBe(1)
      expect(queued[0].status).toBe("pending")
      expect(queued[0].attempts).toBe(0)
      expect(queued[0].last_error).toBeNull()
    })

    it("should return 0 when queuing an empty list", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      const count = await providerManager.queueOverflowEmails([])
      expect(count).toBe(0)
    })

    it("should handle full overflow scenario end-to-end", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Exhaust all providers
      await providerManager.recordUsage("mailjet", 200)
      await providerManager.recordUsage("resend", 100)

      // Try to distribute 10 emails — all should overflow
      const emails = Array.from({ length: 10 }, (_, i) => `full${i}@example.com`)
      const { allocations, overflow } = await providerManager.distributeEmails(emails)

      // No allocations possible
      const totalAllocated = allocations.reduce(
        (sum, a) => sum + a.emails.length,
        0
      )
      expect(totalAllocated).toBe(0)

      // All 10 are overflow
      expect(overflow).toHaveLength(10)

      // Queue them
      const queueEntries = overflow.map((email) => ({
        to_email: email,
        channel: "email",
        template: "blog-template",
        data: { subject: "Blog Post", content: "Hello" },
      }))

      const queued = await providerManager.queueOverflowEmails(queueEntries)
      expect(queued).toBe(10)

      // Verify total remaining is 0
      const totalRemaining = await providerManager.getTotalRemainingCapacity()
      expect(totalRemaining).toBe(0)
    })

    it("should update queue entry status", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      // Create a queue entry
      await providerManager.queueOverflowEmails([
        {
          to_email: "status-test@example.com",
          channel: "email",
          template: "test",
          data: { msg: "test" },
        },
      ])

      const [entry] = await providerManager.listEmailQueues(
        { to_email: "status-test@example.com" },
        { take: 1 }
      )

      // Simulate processing -> sent
      await providerManager.updateEmailQueues({
        id: entry.id,
        status: "processing",
      })

      const [processing] = await providerManager.listEmailQueues(
        { id: entry.id },
        { take: 1 }
      )
      expect(processing.status).toBe("processing")

      // Mark as sent
      await providerManager.updateEmailQueues({
        id: entry.id,
        status: "sent",
      })

      const [sent] = await providerManager.listEmailQueues(
        { id: entry.id },
        { take: 1 }
      )
      expect(sent.status).toBe("sent")
    })

    it("should track attempts and errors on queue entries", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      await providerManager.queueOverflowEmails([
        {
          to_email: "retry@example.com",
          channel: "email",
          template: "test",
          data: {},
        },
      ])

      const [entry] = await providerManager.listEmailQueues(
        { to_email: "retry@example.com" },
        { take: 1 }
      )

      // Simulate first failure
      await providerManager.updateEmailQueues({
        id: entry.id,
        attempts: 1,
        last_error: "Provider timeout",
        scheduled_for: providerManager.getNextDate(),
      })

      const [retry1] = await providerManager.listEmailQueues(
        { id: entry.id },
        { take: 1 }
      )
      expect(retry1.attempts).toBe(1)
      expect(retry1.last_error).toBe("Provider timeout")

      // Simulate second failure
      await providerManager.updateEmailQueues({
        id: entry.id,
        attempts: 2,
        last_error: "Rate limited",
      })

      // Simulate third failure -> mark as permanently failed
      await providerManager.updateEmailQueues({
        id: entry.id,
        attempts: 3,
        status: "failed",
        last_error: "Exceeded max attempts",
      })

      const [failed] = await providerManager.listEmailQueues(
        { id: entry.id },
        { take: 1 }
      )
      expect(failed.status).toBe("failed")
      expect(failed.attempts).toBe(3)
      expect(failed.last_error).toBe("Exceeded max attempts")
    })

    it("should compute next date correctly", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()
      const providerManager = container.resolve("email_provider_manager")

      const nextDate = providerManager.getNextDate()

      // Should be tomorrow in YYYY-MM-DD format
      const tomorrow = new Date()
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
      const expected = tomorrow.toISOString().split("T")[0]

      expect(nextDate).toBe(expected)

      // Also test with a specific date
      const nextFromSpecific = providerManager.getNextDate("2026-03-22")
      expect(nextFromSpecific).toBe("2026-03-23")

      // Month boundary
      const nextFromMonthEnd = providerManager.getNextDate("2026-01-31")
      expect(nextFromMonthEnd).toBe("2026-02-01")
    })
  })
})
