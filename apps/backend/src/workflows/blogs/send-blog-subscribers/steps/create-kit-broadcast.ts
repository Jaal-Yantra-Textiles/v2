import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import * as Handlebars from "handlebars"
import { SendingSummary } from "../types"
import { KIT_MODULE } from "../../../../modules/kit"
import type KitService from "../../../../modules/kit/service"
import { EMAIL_TEMPLATES_MODULE } from "../../../../modules/email_templates"
import type EmailTemplatesService from "../../../../modules/email_templates/service"
import { buildKitEmailData, convertContentToHtml } from "../utils/build-email-data"

export const createKitBroadcastStepId = "create-kit-broadcast"

const BLOG_TEMPLATE_KEY = "blog-subscriber"

// Register the same Handlebars helpers the per-recipient render uses, so the
// single Kit render produces identical markup.
let helpersRegistered = false
function ensureHandlebarsHelpers() {
  if (helpersRegistered) return
  Handlebars.registerHelper("formatDate", function (value: any, options: Handlebars.HelperOptions) {
    try {
      const locale = options?.hash?.locale || "en-US"
      const dateStyle = options?.hash?.dateStyle || "medium"
      const date = new Date(value)
      if (isNaN(date.getTime())) return value ?? ""
      return new Intl.DateTimeFormat(locale, { dateStyle } as any).format(date)
    } catch {
      return value ?? ""
    }
  })
  Handlebars.registerHelper("formatYear", (value: any) => {
    const d = new Date(value)
    return isNaN(d.getTime()) ? (value ?? "") : `${d.getFullYear()}`
  })
  Handlebars.registerHelper("capitalize", (value: string) =>
    typeof value === "string" && value.length
      ? value.charAt(0).toUpperCase() + value.slice(1)
      : value ?? ""
  )
  helpersRegistered = true
}

/**
 * Render the blog body ONCE (Kit Liquid for per-recipient first_name /
 * unsubscribe), create a Kit broadcast scoped to the blog tag with
 * `send_at = now`, and persist an audit row linking the page to the broadcast.
 * Kit fans the actual send out on its side — no per-recipient loop, no daily cap.
 *
 * Returns a {@link SendingSummary}-shaped object so the existing
 * `updatePageWithResultsStep` consumes it unchanged. There is no per-recipient
 * send list (Kit owns delivery), so `sentCount` reflects the tagged recipients.
 */
export const createKitBroadcastStep = createStep(
  createKitBroadcastStepId,
  async (
    input: {
      page_id: string
      blogData: any
      emailConfig: { subject: string; customMessage?: string }
      recipientCount: number
    },
    { container }
  ) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const kit = container.resolve(KIT_MODULE) as KitService
    const templates = container.resolve(EMAIL_TEMPLATES_MODULE) as EmailTemplatesService

    const template = await templates.getTemplateByKey(BLOG_TEMPLATE_KEY)
    ensureHandlebarsHelpers()
    const compiledHtml = Handlebars.compile(template.html_content)
    const compiledSubject = Handlebars.compile(template.subject)

    const blogHtml = convertContentToHtml(input.blogData.content)
    const data = buildKitEmailData(input.blogData, blogHtml, input.emailConfig)

    const subject = compiledSubject(data)
    const html = compiledHtml(data)
    const sentAt = new Date()

    const broadcast = await kit.createBroadcast({
      subject,
      html,
      sendAt: sentAt.toISOString(),
    })

    // Audit row linking page → Kit broadcast (for the stats poller / tracing).
    let auditId: string | null = null
    try {
      const [row] = await kit.createKitBroadcasts([
        {
          page_id: input.page_id,
          kit_broadcast_id: broadcast.id,
          recipient_count: input.recipientCount,
          sent_at: sentAt,
        },
      ])
      auditId = row?.id ?? null
    } catch (e) {
      logger.error(
        `[createKitBroadcast] Failed to persist audit row: ${(e as Error).message}`
      )
    }

    logger.info(
      `[createKitBroadcast] Created Kit broadcast ${broadcast.id} for page ${input.page_id} (${input.recipientCount} recipients)`
    )

    const summary: SendingSummary = {
      totalSubscribers: input.recipientCount,
      sentCount: input.recipientCount,
      failedCount: 0,
      queuedCount: 0,
      sentList: [],
      failedList: [],
      sentAt: sentAt.toISOString(),
    }

    return new StepResponse({ summary, kit_broadcast_id: broadcast.id, auditId }, { auditId })
  },
  // Compensation: drop the audit row if a later step fails. (The Kit broadcast
  // itself sends at send_at≈now and cannot be recalled, so we only unwind our DB.)
  async (compensationInput, { container }) => {
    const auditId = (compensationInput as any)?.auditId
    if (!auditId) return
    const kit = container.resolve(KIT_MODULE) as KitService
    await kit.deleteKitBroadcasts([auditId]).catch(() => {})
  }
)
