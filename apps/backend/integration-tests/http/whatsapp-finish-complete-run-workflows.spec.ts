import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

const TEST_PHONE = "919000000078"

jest.setTimeout(60 * 1000)

/**
 * 🔴 #2248 — a partner's WhatsApp Finish and Complete must do what the
 * portal's buttons do.
 *
 * The handler wrote the run by hand. Finish moved the design to a status the
 * portal never uses; Complete flipped the run to `completed` and nothing else —
 * no design move, no tasks closed, no finished goods banked, no parent run
 * cascaded. Each test below asserts a side effect ONLY the workflow produces,
 * read back from the database.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("WhatsApp Finish / Complete run their workflows", () => {
    let restore: () => void
    let sent: any[] = []

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
      }
      const record = (type: string) => async (to: string, payload: any) => {
        sent.push({ type, to, payload })
        return { messages: [{ id: `wamid.mock_${Date.now()}_${sent.length}` }] }
      }
      whatsapp.sendTextMessage = record("text")
      whatsapp.sendInteractiveMessage = record("interactive")
      whatsapp.sendTemplateMessage = record("template")
      whatsapp.markAsRead = async () => ({ success: true })
      restore = () => Object.assign(whatsapp, originals)
      sent = []
    })

    afterEach(() => restore())

    /** A partner who reaches command dispatch, a design in development, and a
     *  started run — finished too when `finished` is set. */
    async function seed(opts: { finished: boolean; quantity?: number }) {
      const container = getContainer()
      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const partner = await (container.resolve(PARTNER_MODULE) as any).createPartners({
        name: `Finish Partner ${unique}`,
        handle: `wa-finish-${unique}`,
        status: "active",
        whatsapp_number: TEST_PHONE,
        whatsapp_verified: true,
      })
      await (container.resolve(PARTNER_MODULE) as any).createPartnerAdmins({
        partner_id: partner.id,
        email: `wa-finish-${unique}@jyt.test`,
        first_name: "Finish",
        last_name: "Partner",
        phone: TEST_PHONE,
        is_active: true,
      })
      await (container.resolve(MESSAGING_MODULE) as any).createMessagingConversations({
        partner_id: partner.id,
        phone_number: TEST_PHONE,
        title: "Finish Test",
        status: "active",
        metadata: { consent_given: true, language: "en", onboarded: true },
      })
      const design = await (container.resolve(DESIGN_MODULE) as any).createDesigns({
        name: `Finish Design ${unique}`,
        description: "WhatsApp finish/complete test design",
        status: "In_Development",
      })
      const now = new Date()
      const run = await (container.resolve(PRODUCTION_RUNS_MODULE) as any).createProductionRuns({
        design_id: design.id,
        partner_id: partner.id,
        status: "in_progress",
        run_type: "production",
        quantity: opts.quantity ?? 3,
        accepted_at: now,
        started_at: now,
        ...(opts.finished ? { finished_at: now } : {}),
        snapshot: {},
        captured_at: now,
      })
      return { partner, design, run }
    }

    async function send(message: Record<string, any>) {
      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      return handleIncomingMessage(getContainer(), {
        messageId: `wamid.fc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        from: TEST_PHONE,
        timestamp: Math.floor(Date.now() / 1000),
        ...message,
      } as any)
    }

    const readBack = async (runId: string, designId: string) => {
      const container = getContainer()
      const run = await (container.resolve(PRODUCTION_RUNS_MODULE) as any).retrieveProductionRun(runId)
      const [design] = await (container.resolve(DESIGN_MODULE) as any).listDesigns({ id: designId })
      return { run, design_status: design.status }
    }

    it("Finish moves the design the way the portal does (Revision), not by hand", async () => {
      const { run, design } = await seed({ finished: false })
      const result = await send({ type: "interactive", buttonReplyId: `finish_${run.id}` })

      // The handler CATCHES failures and returns handled:true — `error` is the signal.
      expect((result as any).error).toBeUndefined()
      const after = await readBack(run.id, design.id)
      expect(after.run.finished_at).toBeTruthy()
      // The hand-written path jumped to Technical_Review; the workflow says Revision.
      expect(after.design_status).toBe("Revision")
    })

    it("Complete with a count runs the complete workflow — the design moves on", async () => {
      const { run, design } = await seed({ finished: true, quantity: 3 })
      const result = await send({ type: "text", text: `complete ${run.id} 3` })

      expect((result as any).error).toBeUndefined()
      expect(result.action).toBe("complete")
      const after = await readBack(run.id, design.id)
      expect(after.run.status).toBe("completed")
      expect(after.run.produced_quantity).toBe(3)
      // Only the workflow touches the design on Complete; the old path never did.
      expect(after.design_status).toBe("Technical_Review")
    })

    it("Complete with no count asks for it instead of completing blind", async () => {
      const { run, design } = await seed({ finished: true, quantity: 3 })
      const result = await send({ type: "interactive", buttonReplyId: `complete_${run.id}` })

      expect(result.action).toBe("complete_prompt")
      const after = await readBack(run.id, design.id)
      expect(after.run.status).toBe("in_progress")
      expect(sent.some((m) => typeof m.payload === "string" && /number of \*good\* pieces/i.test(m.payload))).toBe(true)
    })
  })
})
