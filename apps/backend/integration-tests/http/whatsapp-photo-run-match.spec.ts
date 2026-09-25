import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

jest.setTimeout(90 * 1000)

// System One is not reachable in tests: stand in for it, per test.
const classifyMock = jest.fn()
jest.mock("../../src/lib/ai/classify", () => {
  const actual = jest.requireActual("../../src/lib/ai/classify")
  return { ...actual, classify: (...args: any[]) => classifyMock(...args) }
})

/**
 * A burst of WhatsApp photos, end to end.
 *
 * 1. Photos with no destination were answered PER PHOTO ("📥 Received. Add a
 *    caption…") — Bhagalpur got ~25 for one burst on 2026-09-15 — on top of
 *    the sweep's single "what are these for?". Now only the sweep speaks.
 * 2. A partner with one run in progress had photos filed on it silently. Now
 *    the burst reply names the run's design and asks, with ✅ Yes / ❌ No, and
 *    "No" takes the photos off the run and queues the "what are these for?"
 *    question instead.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("WhatsApp photos: System One picks the run, or says none", () => {
    let restore: () => void
    let sent: any[] = []
    let phone = ""

    beforeAll(async () => {
      await createAdminUser(getContainer())
    })

    beforeEach(() => {
      const whatsapp = (getContainer().resolve(SOCIAL_PROVIDER_MODULE) as any).getWhatsApp(getContainer())
      const originals = {
        sendTextMessage: whatsapp.sendTextMessage.bind(whatsapp),
        sendInteractiveMessage: whatsapp.sendInteractiveMessage.bind(whatsapp),
        sendTemplateMessage: whatsapp.sendTemplateMessage.bind(whatsapp),
        markAsRead: whatsapp.markAsRead?.bind(whatsapp),
        getMediaUrl: whatsapp.getMediaUrl?.bind(whatsapp),
        downloadMedia: whatsapp.downloadMedia?.bind(whatsapp),
      }
      const record = (type: string) => async (to: string, payload: any) => {
        sent.push({ type, to, payload })
        return { messages: [{ id: `wamid.mock_${Date.now()}_${sent.length}` }] }
      }
      whatsapp.sendTextMessage = record("text")
      whatsapp.sendInteractiveMessage = record("interactive")
      whatsapp.sendTemplateMessage = record("template")
      whatsapp.markAsRead = async () => ({ success: true })
      // Meta's media API, stood in for: a tiny JPEG header is enough to save.
      whatsapp.getMediaUrl = async (id: string) => ({ url: `https://lookaside.test/${id}` })
      whatsapp.downloadMedia = async () => ({
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]),
        contentType: "image/jpeg",
      })
      restore = () => Object.assign(whatsapp, originals)
      sent = []
      phone = `9190000${Math.floor(Math.random() * 1e5).toString().padStart(5, "0")}`
    })

    afterEach(() => restore())

    async function seed(withRun: boolean, extraRun = false) {
      const container = getContainer()
      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const partner = await (container.resolve(PARTNER_MODULE) as any).createPartners({
        name: `Photo Partner ${unique}`,
        handle: `wa-photo-${unique}`,
        status: "active",
        whatsapp_number: phone,
        whatsapp_verified: true,
      })
      await (container.resolve(PARTNER_MODULE) as any).createPartnerAdmins({
        partner_id: partner.id,
        email: `wa-photo-${unique}@jyt.test`,
        first_name: "Photo",
        last_name: "Partner",
        phone,
        is_active: true,
      })
      const conversation = await (container.resolve(MESSAGING_MODULE) as any).createMessagingConversations({
        partner_id: partner.id,
        phone_number: phone,
        title: "Photo Test",
        status: "active",
        metadata: { consent_given: true, language: "en", onboarded: true },
      })
      if (!withRun) return { partner, conversation, run: null, design: null }

      const design = await (container.resolve(DESIGN_MODULE) as any).createDesigns({
        name: `Luong Shirt ${unique}`,
        description: "photo context test",
        status: "In_Development",
      })
      const now = new Date()
      const run = await (container.resolve(PRODUCTION_RUNS_MODULE) as any).createProductionRuns({
        design_id: design.id,
        partner_id: partner.id,
        status: "in_progress",
        run_type: "production",
        quantity: 1,
        accepted_at: now,
        started_at: now,
        snapshot: {},
        captured_at: now,
      })
      let run2: any = null
      if (extraRun) {
        const d2 = await (container.resolve(DESIGN_MODULE) as any).createDesigns({
          name: `Oshen Robe ${unique}`,
          description: "photo context test 2",
          status: "In_Development",
        })
        run2 = await (container.resolve(PRODUCTION_RUNS_MODULE) as any).createProductionRuns({
          design_id: d2.id,
          partner_id: partner.id,
          status: "in_progress",
          run_type: "production",
          quantity: 1,
          accepted_at: now,
          started_at: now,
          snapshot: {},
          captured_at: now,
        })
      }
      return { partner, conversation, run, design, run2 }
    }

    async function sendPhoto(n: number, caption?: string) {
      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      return handleIncomingMessage(getContainer(), {
        messageId: `wamid.photo_${Date.now()}_${n}_${Math.random().toString(36).slice(2, 6)}`,
        from: phone,
        type: "image",
        mediaId: `media_${n}_${Date.now()}`,
        mediaMimeType: "image/jpeg",
        ...(caption ? { text: caption } : {}),
        timestamp: Math.floor(Date.now() / 1000),
      } as any)
    }

    async function tap(id: string) {
      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      return handleIncomingMessage(getContainer(), {
        messageId: `wamid.tap_${Date.now()}`,
        from: phone,
        type: "interactive",
        buttonReplyId: id,
        timestamp: Math.floor(Date.now() / 1000),
      } as any)
    }

    const meta = async (conversationId: string) =>
      ((await (getContainer().resolve(MESSAGING_MODULE) as any).retrieveMessagingConversation(conversationId))
        ?.metadata ?? {}) as Record<string, any>

    const designMedia = async (designId: string) => {
      const [d] = await (getContainer().resolve(DESIGN_MODULE) as any).listDesigns({ id: designId })
      return ((d?.media_files as any[]) ?? []).filter((m) => m?.source === "whatsapp")
    }

    const answer = (choice: string, confidence: number) => ({
      model: "test",
      provider: "typesafe",
      platformId: "plat_test",
      answers: { run: { type: "choice", choice, confidence, probabilities: {} } },
    })

    beforeEach(() => classifyMock.mockReset())

    it("with two runs in progress, the picked run gets the photo — as a guess to confirm", async () => {
      const { conversation, run } = await seed(true, true)
      // Which option is which depends on list order: pick the one that is `run`.
      classifyMock.mockImplementation(async (_c: any, input: any) => {
        const opt = input.state.runs_in_progress.find((r: any) => r.design.startsWith("Luong Shirt")).option
        return answer(opt, 0.92)
      })
      await sendPhoto(1, "sleeve done")

      expect(classifyMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ scope: "whatsapp_photo_context" }))
      const ack = (await meta(conversation.id)).pending_media_ack
      expect(ack?.entries?.[0]).toMatchObject({ kind: "run", label: run!.id, auto: true })
    })

    it("with one run, 'none of these' keeps a stray photo off it and queues the question", async () => {
      const { conversation, design } = await seed(true)
      classifyMock.mockResolvedValue(answer("none", 0.95))
      await sendPhoto(1, "fabric sample")

      expect(await designMedia(design!.id)).toHaveLength(0)
      expect((await meta(conversation.id)).pending_photo_batch?.message_ids).toHaveLength(1)
    })

    it("when System One cannot answer, the one-run rule still applies", async () => {
      const { conversation, run } = await seed(true)
      classifyMock.mockResolvedValue(null)
      await sendPhoto(1, "progress")

      const ack = (await meta(conversation.id)).pending_media_ack
      expect(ack?.entries?.[0]).toMatchObject({ kind: "run", label: run!.id, auto: true })
    })
  })
})
