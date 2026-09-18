import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { extractPartnerIntent } from "../../src/workflows/whatsapp/whatsapp-intent"
import { handleFreeFormPartnerReply } from "../../src/workflows/whatsapp/whatsapp-freeform-chat"

// The intent "query planner" and the free-form reply are model-backed, so they
// are mocked here — these integration tests verify the HANDLER wiring: that a
// text message is routed by the intent model's `action`, that the evaluated
// `language` reaches the free-form reply, and that a missing model degrades to
// the old regex parser. No live model is required.
jest.mock("../../src/workflows/whatsapp/whatsapp-intent", () => ({
  extractPartnerIntent: jest.fn(),
}))

jest.mock("../../src/workflows/whatsapp/whatsapp-freeform-chat", () => ({
  handleFreeFormPartnerReply: jest.fn(async () => ({ handled: true, action: "freeform_reply" })),
  isFreeformChatEnabled: jest.fn(() => true),
}))

const TEST_PHONE = "919876543219"

jest.setTimeout(120 * 1000)

const extractMock = extractPartnerIntent as jest.MockedFunction<typeof extractPartnerIntent>
const freeformMock = handleFreeFormPartnerReply as jest.MockedFunction<
  typeof handleFreeFormPartnerReply
>

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("WhatsApp intent query planner routing", () => {
    let mockSentMessages: any[] = []
    let restoreMock: () => void

    function mockWhatsAppService() {
      const container = getContainer()
      const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as any
      const whatsapp = socialProvider.getWhatsApp(container)

      const createMockResponse = (type: string, to: string, payload: any) => {
        const id = `wamid.mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        mockSentMessages.push({ type, to, payload, id })
        return { messages: [{ id }] }
      }

      const originals = {
        sendTextMessage: whatsapp.sendTextMessage.bind(whatsapp),
        sendInteractiveMessage: whatsapp.sendInteractiveMessage.bind(whatsapp),
        sendTemplateMessage: whatsapp.sendTemplateMessage.bind(whatsapp),
        sendMediaMessage: whatsapp.sendMediaMessage?.bind(whatsapp),
        markAsRead: whatsapp.markAsRead?.bind(whatsapp),
      }

      whatsapp.sendTextMessage = async (to: string, text: string) =>
        createMockResponse("text", to, { text })
      whatsapp.sendInteractiveMessage = async (to: string, interactive: any) =>
        createMockResponse("interactive", to, interactive)
      whatsapp.sendTemplateMessage = async (to: string, name: string, lang: string, components?: any) =>
        createMockResponse("template", to, { name, lang, components })
      whatsapp.sendMediaMessage = async (to: string, ...args: any[]) =>
        createMockResponse("media", to, { args })
      whatsapp.markAsRead = async () => ({ success: true })

      return () => { Object.assign(whatsapp, originals) }
    }

    async function createOnboardedPartner() {
      const container = getContainer()
      const partnerService = container.resolve(PARTNER_MODULE) as any
      const messagingService = container.resolve(MESSAGING_MODULE) as any
      const unique = Date.now()

      const partner = await partnerService.createPartners({
        name: `Intent Partner ${unique}`,
        handle: `wa-intent-${unique}`,
        status: "active",
        whatsapp_number: TEST_PHONE,
        whatsapp_verified: true,
      })
      await partnerService.createPartnerAdmins({
        partner_id: partner.id,
        email: `wa-intent-${unique}@jyt.test`,
        first_name: "Intent",
        last_name: "Partner",
        phone: TEST_PHONE,
        is_active: true,
      })
      // Pre-seed a consent+onboarded conversation so the message reaches the
      // command/free-form dispatch without walking the consent flow.
      await messagingService.createMessagingConversations({
        partner_id: partner.id,
        phone_number: TEST_PHONE,
        title: "Intent Test",
        status: "active",
        metadata: { consent_given: true, language: "en", onboarded: true },
      })
      return partner
    }

    beforeAll(async () => {
      await createAdminUser(getContainer())
    })

    beforeEach(() => {
      restoreMock = mockWhatsAppService()
      extractMock.mockReset()
      freeformMock.mockReset()
      freeformMock.mockResolvedValue({ handled: true, action: "freeform_reply" })
    })

    afterEach(() => {
      restoreMock()
    })

    it("routes a text message by the intent planner's action, not by regex", async () => {
      extractMock.mockResolvedValue({
        language: "hinglish",
        action: "help",
        run_id: null,
        quantity: null,
        rejected_quantity: null,
        notes: null,
      })

      const container = getContainer()
      await createOnboardedPartner()
      mockSentMessages = []

      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      const result = await handleIncomingMessage(container, {
        messageId: `wamid.intent_route_${Date.now()}`,
        from: TEST_PHONE,
        type: "text",
        text: "totally arbitrary prose that matches no command keyword",
        timestamp: Math.floor(Date.now() / 1000),
      } as any)

      expect(result.handled).toBe(true)
      expect(result.action).toBe("help")
      const help = mockSentMessages.find((m) =>
        m.type === "text" && JSON.stringify(m.payload).includes("Available Commands")
      )
      expect(help).toBeDefined()
    })

    it("passes the intent-evaluated language to the free-form reply", async () => {
      extractMock.mockResolvedValue({
        language: "devanagari",
        action: null,
        run_id: null,
        quantity: null,
        rejected_quantity: null,
        notes: null,
      })

      const container = getContainer()
      await createOnboardedPartner()

      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      await handleIncomingMessage(container, {
        messageId: `wamid.intent_lang_${Date.now()}`,
        from: TEST_PHONE,
        type: "text",
        text: "क्या हाल है",
        timestamp: Math.floor(Date.now() / 1000),
      } as any)

      expect(freeformMock).toHaveBeenCalled()
      const opts = freeformMock.mock.calls[0][1]
      expect(opts.language).toBe("devanagari")
      expect(opts.partnerId).toBeTruthy()
    })

    it("extracts quantities for a complete command and routes to complete", async () => {
      extractMock.mockResolvedValue({
        language: "english",
        action: "complete",
        run_id: "prod_run_missing",
        quantity: 100,
        rejected_quantity: 3,
        notes: null,
      })

      const container = getContainer()
      await createOnboardedPartner()
      mockSentMessages = []

      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      // The run doesn't exist, so `handleComplete` throws NOT_FOUND — but the
      // point is that the message was routed to the complete action (not
      // treated as conversation), which the thrown error path confirms.
      const result = await handleIncomingMessage(container, {
        messageId: `wamid.intent_complete_${Date.now()}`,
        from: TEST_PHONE,
        type: "text",
        text: "complete it",
        timestamp: Math.floor(Date.now() / 1000),
      } as any)

      expect(result.handled).toBe(true)
      expect(result.action).toBe("complete")
      expect(result.error).toBeTruthy()
    })

    it("falls back to the regex parser when the intent model is unavailable", async () => {
      extractMock.mockResolvedValue(null)

      const container = getContainer()
      await createOnboardedPartner()
      mockSentMessages = []

      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      const result = await handleIncomingMessage(container, {
        messageId: `wamid.intent_fallback_${Date.now()}`,
        from: TEST_PHONE,
        type: "text",
        text: "help",
        timestamp: Math.floor(Date.now() / 1000),
      } as any)

      expect(result.handled).toBe(true)
      expect(result.action).toBe("help")
      const help = mockSentMessages.find((m) =>
        m.type === "text" && JSON.stringify(m.payload).includes("Available Commands")
      )
      expect(help).toBeDefined()
    })
  })
})