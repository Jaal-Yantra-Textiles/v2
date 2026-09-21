import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { PARTNER_MODULE } from "../../src/modules/partner"

const TEST_PHONE = "919876543210"

jest.setTimeout(120 * 1000)

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("WhatsApp Onboarding Flow", () => {
    let mockSentMessages: any[] = []

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

      whatsapp.sendTextMessage = async (to: string, text: string, replyTo?: string) =>
        createMockResponse("text", to, { text, replyTo })
      whatsapp.sendInteractiveMessage = async (to: string, interactive: any) =>
        createMockResponse("interactive", to, interactive)
      whatsapp.sendTemplateMessage = async (to: string, name: string, lang: string, components?: any) =>
        createMockResponse("template", to, { name, lang, components })
      whatsapp.sendMediaMessage = async (to: string, ...args: any[]) =>
        createMockResponse("media", to, { args })
      whatsapp.markAsRead = async () => ({ success: true })

      return () => { Object.assign(whatsapp, originals) }
    }

    it("should complete full onboarding: consent → language → commands", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const restoreMock = mockWhatsAppService()

      try {
        // ── Setup: create partner with admin phone ──
        const partnerService = container.resolve(PARTNER_MODULE) as any
        const unique = Date.now()

        const partner = await partnerService.createPartners({
          name: `Test Partner ${unique}`,
          handle: `wa-test-${unique}`,
          status: "active",
          whatsapp_number: TEST_PHONE,
          whatsapp_verified: true,
        })

        await partnerService.createPartnerAdmins({
          partner_id: partner.id,
          email: `wa-admin-${unique}@jyt.test`,
          first_name: "Rajesh",
          last_name: "Kumar",
          phone: TEST_PHONE,
          is_active: true,
        })

        const { handleIncomingMessage } = await import(
          "../../src/workflows/whatsapp/whatsapp-message-handler"
        )

        // ── Step 1: First message → consent prompt ──
        mockSentMessages = []
        const step1 = await handleIncomingMessage(container, {
          messageId: `wamid.step1_${Date.now()}`,
          from: TEST_PHONE,
          type: "text",
          text: "Hello",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step1.handled).toBe(true)
        expect(step1.action).toBe("consent_requested")

        const consentPrompt = mockSentMessages.find((m) =>
          m.type === "interactive" && JSON.stringify(m.payload).includes("consent_agree")
        )
        expect(consentPrompt).toBeDefined()

        // ── Step 2: Consent agree → language selection ──
        mockSentMessages = []
        const step2 = await handleIncomingMessage(container, {
          messageId: `wamid.step2_${Date.now()}`,
          from: TEST_PHONE,
          type: "interactive",
          buttonReplyId: "consent_agree",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step2.handled).toBe(true)
        expect(step2.action).toBe("consent_agreed")

        const langPrompt = mockSentMessages.find((m) =>
          m.type === "interactive" && JSON.stringify(m.payload).includes("lang_hi")
        )
        expect(langPrompt).toBeDefined()

        // ── Step 3: Select Hindi → welcome message ──
        mockSentMessages = []
        const step3 = await handleIncomingMessage(container, {
          messageId: `wamid.step3_${Date.now()}`,
          from: TEST_PHONE,
          type: "interactive",
          buttonReplyId: "lang_hi",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step3.handled).toBe(true)
        expect(step3.action).toBe("language_selected_hi")

        const hindiWelcome = mockSentMessages.find((m) =>
          m.type === "text" && m.payload?.text?.includes("आप तैयार हैं")
        )
        expect(hindiWelcome).toBeDefined()

        // ── Step 4: Verify metadata ──
        const messagingService = container.resolve(MESSAGING_MODULE) as any
        const [conversations] = await messagingService.listAndCountMessagingConversations(
          { partner_id: partner.id },
          { take: 10 }
        )
        expect(conversations.length).toBeGreaterThan(0)

        const meta = conversations[0].metadata as Record<string, any>
        expect(meta.consent_given).toBe(true)
        expect(meta.language).toBe("hi")
        expect(meta.onboarded).toBe(true)

        // ── Step 5: Help command in Hindi ──
        mockSentMessages = []
        const step5 = await handleIncomingMessage(container, {
          messageId: `wamid.step5_${Date.now()}`,
          from: TEST_PHONE,
          type: "text",
          text: "help",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step5.handled).toBe(true)
        expect(step5.action).toBe("help")

        const hindiHelp = mockSentMessages.find((m) =>
          m.type === "text" && m.payload?.text?.includes("उपलब्ध कमांड")
        )
        expect(hindiHelp).toBeDefined()

        // ── Step 6: Reset language → re-prompt ──
        await messagingService.updateMessagingConversations({
          id: conversations[0].id,
          metadata: { ...meta, language: null, onboarded: false },
        })

        mockSentMessages = []
        const step6 = await handleIncomingMessage(container, {
          messageId: `wamid.step6_${Date.now()}`,
          from: TEST_PHONE,
          type: "text",
          text: "runs",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step6.handled).toBe(true)
        expect(step6.action).toBe("language_requested")

        // ── Step 7: Select English ──
        mockSentMessages = []
        const step7 = await handleIncomingMessage(container, {
          messageId: `wamid.step7_${Date.now()}`,
          from: TEST_PHONE,
          type: "interactive",
          buttonReplyId: "lang_en",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step7.handled).toBe(true)
        expect(step7.action).toBe("language_selected_en")

        const englishWelcome = mockSentMessages.find((m) =>
          m.type === "text" && m.payload?.text?.includes("you're all set")
        )
        expect(englishWelcome).toBeDefined()

        // ── Step 8: English help ──
        mockSentMessages = []
        const step8 = await handleIncomingMessage(container, {
          messageId: `wamid.step8_${Date.now()}`,
          from: TEST_PHONE,
          type: "text",
          text: "help",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        expect(step8.handled).toBe(true)
        expect(step8.action).toBe("help")

        const englishHelp = mockSentMessages.find((m) =>
          m.type === "text" && m.payload?.text?.includes("Available Commands")
        )
        expect(englishHelp).toBeDefined()

      } finally {
        restoreMock()
      }
    })

    /**
     * 🔴 A RUN ACTION TAPPED BEFORE CONSENT MUST SURVIVE THE GATE (#2211).
     *
     * A partner's first ever contact is the run-assignment template, so the
     * first thing they tap is "Accept" — and it lands before consent exists.
     * The gate used to return `consent_requested` and drop it. Ksaman Naturals
     * lost two of three Accepts that way on 2026-09-09; the platform then sent
     * six "no response" reminders over nine days and auto-reassigned one of
     * those runs away from her on 2026-09-18. Nothing errored.
     */
    it("remembers a run Accept tapped before consent and acts on it after", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const restoreMock = mockWhatsAppService()
      const phone = "919876500011"

      try {
        const partnerService = container.resolve(PARTNER_MODULE) as any
        const unique = Date.now()
        const partner = await partnerService.createPartners({
          name: `PreConsent Partner ${unique}`,
          handle: `wa-preconsent-${unique}`,
          status: "active",
          whatsapp_number: phone,
          whatsapp_verified: true,
        })
        await partnerService.createPartnerAdmins({
          partner_id: partner.id,
          email: `wa-preconsent-${unique}@jyt.test`,
          first_name: "Geeta",
          last_name: "Sharma",
          phone,
          is_active: true,
        })

        const { handleIncomingMessage } = await import(
          "../../src/workflows/whatsapp/whatsapp-message-handler"
        )

        // ── Accept tapped as the very first message, before any consent ──
        mockSentMessages = []
        const tap = await handleIncomingMessage(container, {
          messageId: `wamid.preconsent_${Date.now()}`,
          from: phone,
          type: "interactive",
          buttonReplyId: "accept_prod_run_preconsent_demo",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        // The gate still asks for consent — that part is correct and unchanged.
        expect(tap.handled).toBe(true)
        expect(tap.action).toBe("consent_requested")

        // 🔴 …but the tap is now REMEMBERED, with the run resolved at tap time.
        const messagingService = container.resolve(MESSAGING_MODULE) as any
        const [convs] = await messagingService.listAndCountMessagingConversations(
          { partner_id: partner.id },
          { take: 5 }
        )
        expect(convs.length).toBeGreaterThan(0)
        const stashed = (convs[0].metadata || {}).action_pending_consent
        expect(stashed).toBeDefined()
        expect(stashed.action).toBe("accept")
        expect(stashed.run_id).toBe("prod_run_preconsent_demo")

        // ── Consent, then language: the replay fires on the first message
        //    after the conversation is fully onboarded ──
        mockSentMessages = []
        await handleIncomingMessage(container, {
          messageId: `wamid.preconsent_agree_${Date.now()}`,
          from: phone,
          type: "interactive",
          buttonReplyId: "consent_agree",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        mockSentMessages = []
        const afterLang = await handleIncomingMessage(container, {
          messageId: `wamid.preconsent_lang_${Date.now()}`,
          from: phone,
          type: "interactive",
          buttonReplyId: "lang_en",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)
        expect(afterLang.action).toBe("language_selected_en")

        mockSentMessages = []
        const replay = await handleIncomingMessage(container, {
          messageId: `wamid.preconsent_next_${Date.now()}`,
          from: phone,
          type: "text",
          text: "hello",
          timestamp: Math.floor(Date.now() / 1000),
        } as any)

        /*
         * The run id is synthetic, so accepting it cannot succeed — and that
         * is precisely what makes this a good assertion. What is being proved
         * is that the stashed tap was ACTED ON rather than discarded: either
         * the accept ran, or it was attempted and reported. The old code
         * returned neither, silently.
         */
        expect(
          [
            "accept",
            "pre_consent_replay_failed",
            "pre_consent_action_reoffered",
          ]
        ).toContain(replay.action)

        // And it is cleared, so it cannot re-fire on every later message.
        const [convsAfter] =
          await messagingService.listAndCountMessagingConversations(
            { partner_id: partner.id },
            { take: 5 }
          )
        expect(
          (convsAfter[0].metadata || {}).action_pending_consent
        ).toBeFalsy()
      } finally {
        restoreMock()
      }
    })
  })
})
