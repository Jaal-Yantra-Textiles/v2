import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { Modules } from "@medusajs/framework/utils"

jest.setTimeout(30000)

setupSharedTestSuite(() => {
  describe("Mailjet _already_sent bypass", () => {
    let headers: any

    beforeEach(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      headers = await getAuthHeaders(api)
    })

    it("should skip actual sending when _already_sent is true and return external ID", async () => {
      const { getContainer } = getSharedTestEnv()
      const container = getContainer()

      // Resolve the mailjet provider directly from the container
      // In test env, the module may not be registered as a notification provider,
      // so we instantiate the service class directly
      const MailjetService = (await import("../../src/modules/mailjet/service")).default

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }

      const service = new MailjetService(
        { logger: mockLogger as any },
        {
          api_key: "test_api_key",
          secret_key: "test_secret_key",
          from_email: "test@example.com",
          from_name: "Test",
        }
      )

      // Call send() with _already_sent flag — should NOT call Mailjet API
      const result = await service.send({
        to: "recipient@example.com",
        channel: "email_bulk",
        template: "blog-subscriber",
        data: {
          _already_sent: true,
          _external_id: "mj-12345",
          subject: "Test Newsletter",
          blog_content: "<h1>Test</h1>",
        },
      } as any)

      // Should return the external ID without error
      expect(result).toEqual({ id: "mj-12345" })

      // Should have logged the skip message
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Skipping send")
      )
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("mj-12345")
      )
    })

    it("should return 'bulk-sent' as default ID when _external_id is not provided", async () => {
      const MailjetService = (await import("../../src/modules/mailjet/service")).default

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }

      const service = new MailjetService(
        { logger: mockLogger as any },
        {
          api_key: "test_api_key",
          secret_key: "test_secret_key",
          from_email: "test@example.com",
        }
      )

      const result = await service.send({
        to: "recipient@example.com",
        channel: "email_bulk",
        template: "test-template",
        data: {
          _already_sent: true,
        },
      } as any)

      expect(result).toEqual({ id: "bulk-sent" })
    })

    it("should attempt actual Mailjet API call when _already_sent is NOT set", async () => {
      const MailjetService = (await import("../../src/modules/mailjet/service")).default

      const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      }

      const service = new MailjetService(
        { logger: mockLogger as any },
        {
          // Use invalid keys so the API call fails — proving it tried to send
          api_key: "invalid_key",
          secret_key: "invalid_secret",
          from_email: "test@example.com",
        }
      )

      // Without _already_sent, it should try to call Mailjet API and fail
      await expect(
        service.send({
          to: "recipient@example.com",
          channel: "email_bulk",
          template: "test-template",
          data: {
            subject: "Test",
            html: "<p>Hello</p>",
          },
        } as any)
      ).rejects.toThrow()

      // Should NOT have logged the skip message
      expect(mockLogger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("Skipping send")
      )
    })
  })
})
