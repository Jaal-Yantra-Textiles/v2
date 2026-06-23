/**
 * send-ideas-email.ts — #659 slice 2, PR-3.
 *
 * Sends an already-generated + guard-passed tactical-ideas email to the operator
 * recipients, then flips `marketing_ideas_log.sent = true`. Generate and send are
 * SEPARATE workflows (spec §5.6 / §6) so a failed send never loses the guarded
 * draft — it stays in `marketing_ideas_log` and can be re-sent (PR-5 resend route
 * or the daily job re-run).
 *
 * Mirrors `src/workflows/analytics/send-partner-digest-email.ts` exactly:
 *   numbers → Handlebars DB template → notification module → per-recipient
 *   best-effort send. The template row (`marketing-ideas-email`) is seeded by
 *   `src/scripts/seed-marketing-ideas-email.ts` — `getTemplateByKey` THROWS
 *   NOT_FOUND on a missing/inactive row, so the send quietly skips (never crashes
 *   the morning job) when the template isn't provisioned.
 *
 * Channel: `email` (Resend) — this is an OPERATOR-facing internal email, not a
 * partner email, so it uses the generic email channel (not `email_partner`).
 *
 * Guard-fail path: a row with `guard_passed=false` is NEVER sent as an ideas
 * email (fail closed). Instead a best-effort internal "flagged for review" notice
 * goes to the same operator recipients so a silent guard failure is still visible.
 */

import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"
import * as Handlebars from "handlebars"

import { MARKETING_MODULE } from "../../modules/marketing"
import { EMAIL_TEMPLATES_MODULE } from "../../modules/email_templates"
import type EmailTemplatesService from "../../modules/email_templates/service"
import {
  buildIdeasEmailTemplateData,
  isLogSendable,
  resolveIdeasRecipients,
  type IdeasLogLike,
} from "./send-ideas-email-lib"

export const MARKETING_IDEAS_TEMPLATE_KEY = "marketing-ideas-email"

export type SendIdeasEmailInput = {
  /** The `marketing_ideas_log` row id to send (from generate-ideas-email). */
  logId: string
  /** Optional explicit recipient override (else CSV env, else platform admins). */
  recipients?: string[]
}

export type SendIdeasEmailResult = {
  sent: number
  skipped: boolean
  reason?: string
  guard_passed: boolean
  review_notice_sent: boolean
  recipients: number
}

/**
 * Best-effort resolve operator admin emails via the user module. Never throws —
 * a failure just yields [] and the caller falls back to the CSV env.
 */
async function listAdminEmails(container: any): Promise<string[]> {
  try {
    const userService: any = container.resolve(Modules.USER)
    const [users] = await userService.listAndCountUsers({}, { take: 200 })
    return (users || [])
      .map((u: any) => u?.email)
      .filter((e: any): e is string => typeof e === "string")
  } catch (err) {
    console.warn(
      `[marketing-ideas-email] Failed to list admin users: ${
        (err as Error).message
      }`
    )
    return []
  }
}

const sendIdeasEmailStep = createStep(
  { name: "send-marketing-ideas-email", store: true },
  async (input: SendIdeasEmailInput, { container }) => {
    const empty = (
      patch: Partial<SendIdeasEmailResult> = {}
    ): SendIdeasEmailResult => ({
      sent: 0,
      skipped: true,
      guard_passed: false,
      review_notice_sent: false,
      recipients: 0,
      ...patch,
    })

    if (!input?.logId) {
      return new StepResponse(empty({ reason: "no_log_id" }))
    }

    const marketing: any = container.resolve(MARKETING_MODULE)

    // 1) Load the persisted log row (written BEFORE send by generate-ideas-email).
    let log: IdeasLogLike | null = null
    try {
      log = await marketing.retrieveMarketingIdeasLog(input.logId)
    } catch (err) {
      console.warn(
        `[marketing-ideas-email] Log ${input.logId} not found: ${
          (err as Error).message
        }`
      )
      return new StepResponse(empty({ reason: "log_not_found" }))
    }

    if (!log) {
      return new StepResponse(empty({ reason: "log_not_found" }))
    }

    // 2) Resolve recipients: explicit > CSV env > platform admins.
    const adminEmails = await listAdminEmails(container)
    const recipients = resolveIdeasRecipients({
      explicit: input.recipients,
      csv: process.env.MARKETING_IDEAS_RECIPIENTS,
      adminEmails,
    })

    if (recipients.length === 0) {
      console.warn(
        `[marketing-ideas-email] No recipients resolved for log ${input.logId} — skipping`
      )
      return new StepResponse(
        empty({
          reason: "no_recipients",
          guard_passed: log.guard_passed === true,
        })
      )
    }

    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService

    const fromEmail =
      process.env.MARKETING_IDEAS_FROM ||
      process.env.RESEND_FROM ||
      "ops@jaalyantra.com"

    // 3) Guard-fail path: do NOT send the ideas email. Best-effort internal
    //    "flagged for review" notice so the failure is still visible (spec §5.6).
    if (!isLogSendable(log)) {
      let reviewNoticeSent = false
      const subject = "⚠ Marketing ideas email flagged for review"
      const html =
        `<p>The daily marketing-ideas email was generated but the hallucination ` +
        `guard <strong>did not pass</strong>, so it was NOT sent.</p>` +
        `<p>Review log row <code>${log.id}</code> in the marketing ideas log ` +
        `before re-sending.</p>`
      for (const to of recipients) {
        try {
          await notificationService.createNotifications({
            to,
            channel: "email",
            template: MARKETING_IDEAS_TEMPLATE_KEY,
            data: {
              _template_subject: subject,
              _template_html_content: html,
              _template_from: fromEmail,
              _template_processed: true,
              log_id: log.id,
            },
          })
          reviewNoticeSent = true
        } catch (err) {
          console.error(
            `[marketing-ideas-email] Review notice to ${to} failed: ${
              (err as Error).message
            }`
          )
        }
      }
      return new StepResponse(
        empty({
          reason: "guard_failed",
          guard_passed: false,
          review_notice_sent: reviewNoticeSent,
          recipients: recipients.length,
        })
      )
    }

    // 4) Happy path: compile the DB template (best-effort — a missing/inactive
    //    row never crashes the morning job, it just skips the send).
    const emailTemplatesService: EmailTemplatesService =
      container.resolve(EMAIL_TEMPLATES_MODULE)
    let template: any
    try {
      template = await emailTemplatesService.getTemplateByKey(
        MARKETING_IDEAS_TEMPLATE_KEY
      )
    } catch (err) {
      console.warn(
        `[marketing-ideas-email] Template "${MARKETING_IDEAS_TEMPLATE_KEY}" missing/inactive: ${
          (err as Error).message
        }`
      )
      return new StepResponse(
        empty({
          reason: "template_missing",
          guard_passed: true,
          recipients: recipients.length,
        })
      )
    }

    const compiledHtml = Handlebars.compile(template.html_content)
    const compiledSubject = Handlebars.compile(template.subject)

    const dashboardUrl = process.env.MARKETING_DASHBOARD_URL || ""
    const oneGoal =
      process.env.MARKETING_ONE_GOAL ||
      (log as any)?.prompt_snapshot?.one_goal ||
      ""

    const templateData = buildIdeasEmailTemplateData({
      log,
      oneGoal,
      dashboardUrl,
    })
    const renderedHtml = compiledHtml(templateData)
    const renderedSubject = compiledSubject(templateData)

    let sentCount = 0
    for (const to of recipients) {
      try {
        await notificationService.createNotifications({
          to,
          channel: "email",
          template: MARKETING_IDEAS_TEMPLATE_KEY,
          data: {
            ...templateData,
            _template_subject: renderedSubject,
            _template_html_content: renderedHtml,
            _template_from: fromEmail,
            _template_processed: true,
          },
        })
        sentCount++
        console.log(
          `[marketing-ideas-email] Sent ${MARKETING_IDEAS_TEMPLATE_KEY} to ${to} (log: ${log.id})`
        )
      } catch (err) {
        console.error(
          `[marketing-ideas-email] Failed to send to ${to}: ${
            (err as Error).message
          }`
        )
      }
    }

    // 5) Flip sent=true only when at least one recipient actually got it.
    if (sentCount > 0) {
      try {
        await marketing.updateMarketingIdeasLogs({ id: log.id, sent: true })
      } catch (err) {
        console.error(
          `[marketing-ideas-email] Failed to flag log ${log.id} sent: ${
            (err as Error).message
          }`
        )
      }
    }

    const okResult: SendIdeasEmailResult = {
      sent: sentCount,
      skipped: false,
      guard_passed: true,
      review_notice_sent: false,
      recipients: recipients.length,
    }
    return new StepResponse(okResult)
  }
)

export const sendIdeasEmailWorkflow = createWorkflow(
  { name: "send-marketing-ideas-email", store: true },
  (input: SendIdeasEmailInput) => {
    const result = sendIdeasEmailStep(input)
    return new WorkflowResponse(result)
  }
)

export default sendIdeasEmailWorkflow
