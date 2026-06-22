import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"
import * as Handlebars from "handlebars"
import { PARTNER_MODULE } from "../../../modules/partner"
import PartnerService from "../../../modules/partner/service"
import { TASKS_MODULE } from "../../../modules/tasks"
import TaskService from "../../../modules/tasks/service"
import { EMAIL_TEMPLATES_MODULE } from "../../../modules/email_templates"
import EmailTemplatesService from "../../../modules/email_templates/service"
import {
  buildPartnerTaskTemplateData,
  derivePartnerFromEmail,
} from "./partner-task-email-lib"

// ---------------------------------------------------------------------------
// Step: resolve partner + active admins + task, compile the DB template and
// send a "task assigned" email to each active partner admin.
//
// Mirrors sendPartnerOrderNotificationStep (send-partner-order-email.ts):
//   - email_partner channel (Maileroo) so partner mail routes like the rest
//   - DB template fetched/compiled via EmailTemplatesService + Handlebars
//   - per-admin send is best-effort; a missing partner/template skips quietly
// ---------------------------------------------------------------------------
const sendPartnerTaskAssignedStep = createStep(
  { name: "send-partner-task-assigned-notification", store: true },
  async (input: { taskId: string; partnerId: string }, { container }) => {
    const { taskId, partnerId } = input

    if (!partnerId || !taskId) {
      return new StepResponse({ sent: 0, skipped: true })
    }

    // 1) Partner + active admins
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    let partner: any = null
    let admins: any[] = []
    try {
      const partners = await partnerService.listPartners(
        { id: partnerId },
        { relations: ["admins"], select: ["id", "name", "handle"] }
      )
      partner = (partners as any[])?.[0] || null
      admins = (partner?.admins || []).filter((a: any) => a.is_active)
    } catch (err) {
      console.warn(
        `[partner-task-email] Failed to fetch partner ${partnerId}: ${(err as Error).message}`
      )
    }

    if (!partner || admins.length === 0) {
      console.log(
        `[partner-task-email] No partner/admins for task ${taskId} — skipping`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    // 2) Task detail
    const taskService: TaskService = container.resolve(TASKS_MODULE)
    let task: any = null
    try {
      task = await taskService.retrieveTask(taskId)
    } catch (err) {
      console.warn(
        `[partner-task-email] Failed to fetch task ${taskId}: ${(err as Error).message}`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    // 3) DB template (loud-by-design upstream; kept best-effort here so a
    //    missing/inactive row never crashes the task_assigned subscriber)
    const emailTemplatesService: EmailTemplatesService =
      container.resolve(EMAIL_TEMPLATES_MODULE)
    let template: any
    try {
      template = await emailTemplatesService.getTemplateByKey(
        "partner-task-assigned"
      )
    } catch (err) {
      console.warn(
        `[partner-task-email] Template "partner-task-assigned" missing/inactive: ${(err as Error).message}`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    const compiledHtml = Handlebars.compile(template.html_content)
    const compiledSubject = Handlebars.compile(template.subject)

    const fromDomain =
      process.env.MAILEROO_FROM_DOMAIN || "partner.jaalyantra.com"
    const partnerFromEmail = derivePartnerFromEmail(partner.handle, fromDomain)
    const partnerFromName = partner.name || "Jaal Yantra Textiles Partner"
    const taskUrlBase = process.env.PARTNER_DASHBOARD_URL
      ? `${process.env.PARTNER_DASHBOARD_URL}/tasks`
      : ""

    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService

    let sentCount = 0
    for (const admin of admins) {
      const templateData = buildPartnerTaskTemplateData({
        partner,
        admin,
        task,
        storeUrl: process.env.FRONTEND_URL || "",
        taskUrlBase,
      })

      const renderedHtml = compiledHtml(templateData)
      const renderedSubject = compiledSubject(templateData)

      try {
        await notificationService.createNotifications({
          to: admin.email,
          channel: "email_partner",
          template: "partner-task-assigned",
          data: {
            ...templateData,
            _template_subject: renderedSubject,
            _template_html_content: renderedHtml,
            _template_from: partnerFromEmail,
            _template_processed: true,
            _partner_from_email: partnerFromEmail,
            _partner_from_name: partnerFromName,
          },
        })
        sentCount++
        console.log(
          `[partner-task-email] Sent partner-task-assigned to ${admin.email} (partner: ${partner.name})`
        )
      } catch (err) {
        console.error(
          `[partner-task-email] Failed to send to ${admin.email}: ${(err as Error).message}`
        )
      }
    }

    return new StepResponse({ sent: sentCount, skipped: false })
  }
)

export const sendPartnerTaskAssignedWorkflow = createWorkflow(
  { name: "send-partner-task-assigned-email", store: true },
  (input: { taskId: string; partnerId: string }) => {
    const result = sendPartnerTaskAssignedStep(input)
    return new WorkflowResponse(result)
  }
)
