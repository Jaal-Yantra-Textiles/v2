import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { COMPANY_MODULE } from "../../../../../modules/company"
import type CompanyService from "../../../../../modules/company/service"
import { EMAIL_TEMPLATES_MODULE } from "../../../../../modules/email_templates"
import { sendNotificationEmailWorkflow } from "../../../../../workflows/email/send-notification-email"
import {
  INVESTOR_UPDATE_TEMPLATE_KEY,
  planUpdateRecipients,
  updateMessageToHtml,
} from "../../../../../lib/investors/company-update"

const sendUpdateSchema = z.object({
  subject: z.string().trim().min(1, "subject is required").max(200),
  message: z.string().trim().min(1, "message is required").max(20000),
  /** Only these investors; omitted = every investor of the company. */
  investor_ids: z.array(z.string()).optional(),
  /** Signature line; defaults to the signed-in admin's name, else the company. */
  sender_name: z.string().trim().max(120).optional(),
  /** false/omitted = preview only. The letter is sent only with confirm: true. */
  confirm: z.boolean().optional(),
})

/**
 * POST /admin/companies/:id/send-update — a letter from the company to its
 * investors, through the platform email service (template `investor-update`).
 *
 * Previews unless `confirm: true`: the response names every recipient, every
 * investor left out and why, and the rendered body. Each investor gets their
 * own email, so no one sees another investor's address.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const input = sendUpdateSchema.parse(req.body ?? {})
  const companyId = req.params.id

  const companies: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const [company] = await companies.listCompanies({ id: companyId } as any)
  if (!company) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Company not found")
  }
  const companyName = (company as any).legal_name || (company as any).name

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: pipelines } = await query.graph({
    entity: "investor_pipeline",
    fields: ["id", "investor.id", "investor.name", "investor.email"],
    filters: { company_id: companyId },
  })
  const investors = (pipelines ?? []).map((p: any) => p?.investor).filter(Boolean)
  const { recipients, skipped } = planUpdateRecipients(investors, input.investor_ids)

  let templateReady = true
  try {
    await (req.scope.resolve(EMAIL_TEMPLATES_MODULE) as any).getTemplateByKey(
      INVESTOR_UPDATE_TEMPLATE_KEY
    )
  } catch {
    templateReady = false
  }

  const senderName = input.sender_name || (await adminName(req)) || companyName
  const bodyHtml = updateMessageToHtml(input.message)
  const portalUrl = process.env.INVESTOR_UI_URL || "https://invest.jaalyantra.com"

  const plan = {
    company_id: companyId,
    company_name: companyName,
    subject: input.subject,
    sender_name: senderName,
    body_html: bodyHtml,
    template_key: INVESTOR_UPDATE_TEMPLATE_KEY,
    template_ready: templateReady,
    recipients,
    skipped,
  }

  if (!input.confirm) {
    return res.json({ preview: true, sent: 0, ...plan })
  }
  if (!templateReady) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Email template "${INVESTOR_UPDATE_TEMPLATE_KEY}" is missing or inactive — create it before sending`
    )
  }
  if (!recipients.length) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "No investor of this company has an email address to send to")
  }

  const results: Array<{ investor_id: string; email: string; notification_id?: string; error?: string }> = []
  for (const r of recipients) {
    try {
      const { result } = await sendNotificationEmailWorkflow(req.scope).run({
        input: {
          to: r.email,
          template: INVESTOR_UPDATE_TEMPLATE_KEY,
          data: {
            investor_name: r.name,
            subject: input.subject,
            body_html: bodyHtml,
            company_name: companyName,
            sender_name: senderName,
            portal_url: portalUrl,
          },
        },
      })
      results.push({ investor_id: r.investor_id, email: r.email, notification_id: (result as any)?.id })
    } catch (e: any) {
      results.push({ investor_id: r.investor_id, email: r.email, error: e?.message ?? String(e) })
    }
  }

  const sent = results.filter((r) => !r.error).length
  res.json({ preview: false, sent, failed: results.length - sent, results, ...plan })
}

/** The signed-in admin's name; null for API keys and nameless users. */
async function adminName(req: MedusaRequest): Promise<string | null> {
  const actorId = (req as any).auth_context?.actor_id
  if (!actorId || (req as any).auth_context?.actor_type !== "user") return null
  try {
    const user = await (req.scope.resolve(Modules.USER) as any).retrieveUser(actorId)
    const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim()
    return name || null
  } catch {
    return null
  }
}
