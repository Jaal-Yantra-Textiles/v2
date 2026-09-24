import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

jest.setTimeout(90 * 1000)

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

  describe("WhatsApp photo bursts: one reply, and a guessed run is asked about", () => {
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

    async function seed(withRun: boolean) {
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
      return { partner, conversation, run, design }
    }

    async function sendPhoto(n: number) {
      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      return handleIncomingMessage(getContainer(), {
        messageId: `wamid.photo_${Date.now()}_${n}_${Math.random().toString(36).slice(2, 6)}`,
        from: phone,
        type: "image",
        mediaId: `media_${n}_${Date.now()}`,
        mediaMimeType: "image/jpeg",
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

    it("a burst with nowhere to go gets no per-photo reply — it is queued for one question", async () => {
      const { conversation } = await seed(false)
      for (const n of [1, 2, 3]) await sendPhoto(n)

      expect(sent.filter((m) => typeof m.payload === "string" && m.payload.startsWith("📥 Received"))).toEqual([])
      expect((await meta(conversation.id)).pending_photo_batch?.message_ids).toHaveLength(3)
    })

    it("a guessed run is named and asked about; ❌ No takes the photos off it", async () => {
      const { conversation, run, design } = await seed(true)
      for (const n of [1, 2]) await sendPhoto(n)
      expect(await designMedia(design!.id)).toHaveLength(2)

      // Let the burst settle, then run the sweep that replies once.
      const m = await meta(conversation.id)
      const settled = { ...m.pending_media_ack, first_at: new Date(Date.now() - 60_000).toISOString(), last_at: new Date(Date.now() - 60_000).toISOString() }
      await (getContainer().resolve(MESSAGING_MODULE) as any).updateMessagingConversations({
        id: conversation.id,
        metadata: { ...m, pending_media_ack: settled },
      })
      const { default: sendMediaAckBatches } = await import("../../src/jobs/send-media-ack-batches")
      await sendMediaAckBatches(getContainer() as any)

      const ask = sent.find((s) => s.type === "interactive" && s.to === phone)
      expect(ask?.payload?.body?.text).toContain(design!.name)
      expect(ask?.payload?.action?.buttons?.map((b: any) => b.reply.id)).toEqual(["media_ctx_yes", "media_ctx_no"])
      expect((await meta(conversation.id)).pending_media_context?.run_id).toBe(run!.id)

      const result = await tap("media_ctx_no")
      expect(result.action).toBe("media_context_rejected")
      expect(await designMedia(design!.id)).toHaveLength(0)
      const after = await meta(conversation.id)
      expect(after.pending_media_context).toBeUndefined()
      expect(after.pending_photo_batch?.message_ids).toHaveLength(2)
    })

    it("✅ Yes keeps the photos on the run", async () => {
      const { conversation, run, design } = await seed(true)
      await sendPhoto(1)
      const m = await meta(conversation.id)
      await (getContainer().resolve(MESSAGING_MODULE) as any).updateMessagingConversations({
        id: conversation.id,
        metadata: { ...m, pending_media_context: { run_id: run!.id, design: design!.name, message_ids: m.pending_media_ack.message_ids } },
      })

      const result = await tap("media_ctx_yes")
      expect(result.action).toBe("media_context_confirmed")
      expect(await designMedia(design!.id)).toHaveLength(1)
      expect((await meta(conversation.id)).pending_media_context).toBeUndefined()
    })
  })
})
