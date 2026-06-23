import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { MARKETING_MODULE } from "../../src/modules/marketing"
import { EMAIL_TEMPLATES_MODULE } from "../../src/modules/email_templates"
import { Modules } from "@medusajs/framework/utils"
import {
  sendIdeasEmailWorkflow,
  MARKETING_IDEAS_TEMPLATE_KEY,
} from "../../src/workflows/marketing/send-ideas-email"

jest.setTimeout(60 * 1000)

/**
 * #659 slice 2, PR-3 — the send-ideas-email workflow. Base medusa-config.ts
 * registers the `local` notification provider for the `email` channel, so the
 * workflow really persists a notification row (no live Resend in CI). We assert:
 *   - a guard-passing log row sends to the explicit recipients and flips sent=true
 *   - a guard-FAILED row never sends the ideas email (sent stays false)
 *
 * The `marketing-ideas-email` DB template is seeded inline (getTemplateByKey
 * throws NOT_FOUND otherwise, which would make the happy path skip).
 */
setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  async function ensureTemplate(container: any) {
    const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)
    try {
      await svc.getTemplateByKey(MARKETING_IDEAS_TEMPLATE_KEY)
      return
    } catch {
      // not present — create it
    }
    await svc.createEmailTemplates({
      name: "Daily Marketing Ideas",
      template_key: MARKETING_IDEAS_TEMPLATE_KEY,
      from: "ops@jaalyantra.com",
      subject: "Today's marketing moves — {{generated_date}}",
      html_content:
        "<div>{{{ideas_html}}}</div><p>{{model_used}} · {{current_year}}</p>",
      template_type: "marketing_ideas",
      is_active: true,
    })
  }

  describe("sendIdeasEmailWorkflow", () => {
    it("sends a guard-passing ideas log and flips sent=true", async () => {
      const container = getContainer()
      await ensureTemplate(container)
      const svc: any = container.resolve(MARKETING_MODULE)

      const [log] = await svc.createMarketingIdeasLogs([
        {
          generated_for_date: new Date("2031-04-01T00:00:00.000Z"),
          model_used: "anthropic/claude-3.5-sonnet",
          prompt_snapshot: { one_goal: "Grow GMV.", date_ist: "2031-04-01" },
          output_text:
            "Lift ₹1,84,320: launch a flash sale and spotlight a partner.",
          guard_passed: true,
          regenerated: false,
          sent: false,
        },
      ])

      const { result } = await sendIdeasEmailWorkflow(container).run({
        input: { logId: log.id, recipients: ["owner@jyt.local"] },
      })

      expect(result.skipped).toBe(false)
      expect(result.guard_passed).toBe(true)
      expect(result.recipients).toBe(1)
      expect(result.sent).toBe(1)

      const fresh = await svc.retrieveMarketingIdeasLog(log.id)
      expect(fresh.sent).toBe(true)

      // a notification row really landed via the local provider
      const notifSvc: any = container.resolve(Modules.NOTIFICATION)
      const [notifs] = await notifSvc.listAndCountNotifications({
        to: "owner@jyt.local",
        channel: "email",
      })
      expect(notifs.length).toBeGreaterThan(0)
    })

    it("does NOT send a guard-failed log (fail closed)", async () => {
      const container = getContainer()
      await ensureTemplate(container)
      const svc: any = container.resolve(MARKETING_MODULE)

      const [log] = await svc.createMarketingIdeasLogs([
        {
          generated_for_date: new Date("2031-04-02T00:00:00.000Z"),
          model_used: "anthropic/claude-3.5-sonnet",
          prompt_snapshot: { one_goal: "Grow GMV.", date_ist: "2031-04-02" },
          output_text: "Push a 47% discount today.",
          guard_passed: false,
          guard_failures: [{ type: "stray_number", token: "47" }],
          regenerated: true,
          sent: false,
        },
      ])

      const { result } = await sendIdeasEmailWorkflow(container).run({
        input: { logId: log.id, recipients: ["review@jyt.local"] },
      })

      expect(result.sent).toBe(0)
      expect(result.skipped).toBe(true)
      expect(result.reason).toBe("guard_failed")
      expect(result.guard_passed).toBe(false)

      const fresh = await svc.retrieveMarketingIdeasLog(log.id)
      expect(fresh.sent).toBe(false) // never sent
    })

    it("skips cleanly when the log id is unknown", async () => {
      const container = getContainer()
      const { result } = await sendIdeasEmailWorkflow(container).run({
        input: { logId: "mil_does_not_exist", recipients: ["x@jyt.local"] },
      })
      expect(result.skipped).toBe(true)
      expect(result.sent).toBe(0)
      expect(result.reason).toBe("log_not_found")
    })
  })
})
