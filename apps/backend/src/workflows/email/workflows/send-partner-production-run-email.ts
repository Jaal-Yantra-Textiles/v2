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
import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import ProductionRunsService from "../../../modules/production_runs/service"
import { EMAIL_TEMPLATES_MODULE } from "../../../modules/email_templates"
import EmailTemplatesService from "../../../modules/email_templates/service"
import {
  buildPartnerProductionRunTemplateData,
  derivePartnerFromEmail,
  resolvePartnerProductionRunTemplateKey,
  type ProductionRunEmailAction,
} from "../lib/partner-production-run-email"

// ---------------------------------------------------------------------------
// Step: resolve partner (from the run when the event omits partner_id) + active
// admins + run detail, compile the DB template and email each active partner
// admin about a completed/cancelled production run (#576 slice B).
//
// Mirrors sendPartnerTaskAssignedStep (send-partner-task-assigned-email.ts):
//   - email_partner channel (Maileroo) so partner mail routes like the rest
//   - DB template fetched/compiled via EmailTemplatesService + Handlebars
//   - per-admin send is best-effort; a missing partner/template skips quietly
// ---------------------------------------------------------------------------
const sendPartnerProductionRunStep = createStep(
  { name: "send-partner-production-run-notification", store: true },
  async (
    input: {
      productionRunId: string
      partnerId?: string
      action: ProductionRunEmailAction
      notes?: string
    },
    { container }
  ) => {
    const { productionRunId, action } = input

    const templateKey = resolvePartnerProductionRunTemplateKey(action)
    if (!productionRunId || !templateKey) {
      return new StepResponse({ sent: 0, skipped: true })
    }

    // 1) Run detail — also the partner_id fallback when the event omits it
    //    (the admin cancel route emits production_run.cancelled with no partner_id).
    const runService: ProductionRunsService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )
    let run: any = null
    try {
      run = await runService.retrieveProductionRun(productionRunId)
    } catch (err) {
      console.warn(
        `[partner-run-email] Failed to fetch run ${productionRunId}: ${(err as Error).message}`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    const partnerId = input.partnerId || run?.partner_id || null
    if (!partnerId) {
      console.log(
        `[partner-run-email] No partner for run ${productionRunId} — skipping`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    // 2) Partner + active admins
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
        `[partner-run-email] Failed to fetch partner ${partnerId}: ${(err as Error).message}`
      )
    }

    if (!partner || admins.length === 0) {
      console.log(
        `[partner-run-email] No partner/admins for run ${productionRunId} — skipping`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    // 3) DB template (best-effort: a missing/inactive row never crashes the
    //    production-run lifecycle subscriber).
    const emailTemplatesService: EmailTemplatesService =
      container.resolve(EMAIL_TEMPLATES_MODULE)
    let template: any
    try {
      template = await emailTemplatesService.getTemplateByKey(templateKey)
    } catch (err) {
      console.warn(
        `[partner-run-email] Template "${templateKey}" missing/inactive: ${(err as Error).message}`
      )
      return new StepResponse({ sent: 0, skipped: true })
    }

    const compiledHtml = Handlebars.compile(template.html_content)
    const compiledSubject = Handlebars.compile(template.subject)

    const fromDomain =
      process.env.MAILEROO_FROM_DOMAIN || "partner.jaalyantra.com"
    const partnerFromEmail = derivePartnerFromEmail(partner.handle, fromDomain)
    const partnerFromName = partner.name || "Jaal Yantra Textiles Partner"
    const runUrlBase = process.env.PARTNER_DASHBOARD_URL
      ? `${process.env.PARTNER_DASHBOARD_URL}/production-runs`
      : ""

    const notificationService = container.resolve(
      Modules.NOTIFICATION
    ) as INotificationModuleService

    let sentCount = 0
    for (const admin of admins) {
      const templateData = buildPartnerProductionRunTemplateData({
        partner,
        admin,
        run,
        action,
        notes: input.notes,
        storeUrl: process.env.FRONTEND_URL || "",
        runUrlBase,
      })

      const renderedHtml = compiledHtml(templateData)
      const renderedSubject = compiledSubject(templateData)

      try {
        await notificationService.createNotifications({
          to: admin.email,
          channel: "email_partner",
          template: templateKey,
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
          `[partner-run-email] Sent ${templateKey} to ${admin.email} (partner: ${partner.name})`
        )
      } catch (err) {
        console.error(
          `[partner-run-email] Failed to send to ${admin.email}: ${(err as Error).message}`
        )
      }
    }

    return new StepResponse({ sent: sentCount, skipped: false })
  }
)

export const sendPartnerProductionRunEmailWorkflow = createWorkflow(
  { name: "send-partner-production-run-email", store: true },
  (input: {
    productionRunId: string
    partnerId?: string
    action: ProductionRunEmailAction
    notes?: string
  }) => {
    const result = sendPartnerProductionRunStep(input)
    return new WorkflowResponse(result)
  }
)
