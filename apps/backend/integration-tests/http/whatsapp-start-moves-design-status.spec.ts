import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { SOCIAL_PROVIDER_MODULE } from "../../src/modules/social-provider"
import { MESSAGING_MODULE } from "../../src/modules/messaging"
import { PARTNER_MODULE } from "../../src/modules/partner"
import { DESIGN_MODULE } from "../../src/modules/designs"
import { PRODUCTION_RUNS_MODULE } from "../../src/modules/production_runs"

const TEST_PHONE = "919000000077"

jest.setTimeout(60 * 1000)

/**
 * 🔴 A partner's "▶️ Start" tap on WhatsApp must do what the portal's Start
 * button does — including moving the design out of `Conceptual`.
 *
 * The WhatsApp handler used to stamp `started_at` and emit the event by hand,
 * never running `startProductionRunWorkflow`, so the design never moved. On
 * prod, Ksaman started the Pashmina Inspired Tunic on 2026-09-09 and its
 * design still read "Conceptual" two weeks later. Partners start work from
 * WhatsApp, so for them the design status simply never advanced.
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("WhatsApp Start runs the start workflow", () => {
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

    /** A partner who can reach command dispatch, a Conceptual design, and an
     *  accepted-but-not-started run of the given type. */
    async function seed(runType: "production" | "sample") {
      const container = getContainer()
      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const partner = await (container.resolve(PARTNER_MODULE) as any).createPartners({
        name: `Start Partner ${unique}`,
        handle: `wa-start-${unique}`,
        status: "active",
        whatsapp_number: TEST_PHONE,
        whatsapp_verified: true,
      })
      await (container.resolve(PARTNER_MODULE) as any).createPartnerAdmins({
        partner_id: partner.id,
        email: `wa-start-${unique}@jyt.test`,
        first_name: "Start",
        last_name: "Partner",
        phone: TEST_PHONE,
        is_active: true,
      })
      await (container.resolve(MESSAGING_MODULE) as any).createMessagingConversations({
        partner_id: partner.id,
        phone_number: TEST_PHONE,
        title: "Start Test",
        status: "active",
        metadata: { consent_given: true, language: "en", onboarded: true },
      })
      const design = await (container.resolve(DESIGN_MODULE) as any).createDesigns({
        name: `Start Design ${unique}`,
        description: "WhatsApp start test design",
        status: "Conceptual",
      })
      const run = await (container.resolve(PRODUCTION_RUNS_MODULE) as any).createProductionRuns({
        design_id: design.id,
        partner_id: partner.id,
        status: "in_progress",
        run_type: runType,
        quantity: 1,
        accepted_at: new Date(),
        snapshot: {},
        captured_at: new Date(),
      })
      return { partner, design, run }
    }

    async function tapStart(runId: string) {
      const { handleIncomingMessage } = await import(
        "../../src/workflows/whatsapp/whatsapp-message-handler"
      )
      return handleIncomingMessage(getContainer(), {
        messageId: `wamid.start_${Date.now()}`,
        from: TEST_PHONE,
        type: "interactive",
        // Run ids already carry the `prod_run_` prefix; the button id is `start_<runId>`.
        buttonReplyId: `start_${runId}`,
        timestamp: Math.floor(Date.now() / 1000),
      } as any)
    }

    const readBack = async (runId: string, designId: string) => {
      const container = getContainer()
      const run = await (container.resolve(PRODUCTION_RUNS_MODULE) as any).retrieveProductionRun(runId)
      const [design] = await (container.resolve(DESIGN_MODULE) as any).listDesigns({ id: designId })
      return { started_at: run.started_at, design_status: design.status }
    }

    it("a production run's Start moves its design to In_Development", async () => {
      const { run, design } = await seed("production")
      const result = await tapStart(run.id)

      // 🔴 The handler CATCHES action failures and still returns handled:true —
      // so `error` is the field that says whether the start actually happened.
      expect((result as any).error).toBeUndefined()
      expect(result.action).toBe("start")
      const after = await readBack(run.id, design.id)
      expect(after.started_at).toBeTruthy()
      expect(after.design_status).toBe("In_Development")
    })

    it("a sample run's Start moves its design to Sample_Production", async () => {
      const { run, design } = await seed("sample")
      const result = await tapStart(run.id)
      expect((result as any).error).toBeUndefined()

      const after = await readBack(run.id, design.id)
      expect(after.started_at).toBeTruthy()
      expect(after.design_status).toBe("Sample_Production")
    })

    it("still refuses a second Start, and leaves the first start time alone", async () => {
      const { run, design } = await seed("production")
      const firstTap = await tapStart(run.id)
      expect((firstTap as any).error).toBeUndefined()
      const first = await readBack(run.id, design.id)
      expect(first.started_at).toBeTruthy()

      const second = await tapStart(run.id)
      const after = await readBack(run.id, design.id)
      // The policy refuses a second start; the handler reports it as `error`.
      expect((second as any).error).toMatch(/already been started/i)
      expect(new Date(after.started_at).getTime()).toBe(new Date(first.started_at).getTime())
    })
  })
})
