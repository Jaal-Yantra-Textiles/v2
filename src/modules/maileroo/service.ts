import {
  AbstractNotificationProviderService,
  MedusaError,
} from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
// maileroo-sdk is ESM-only — use lazy dynamic import
const mailerooImport = import("maileroo-sdk")
type MailerooClientType = InstanceType<
  Awaited<typeof mailerooImport>["MailerooClient"]
>

type InjectedDependencies = {
  logger: Logger
}

type MailerooOptions = {
  api_key: string
  from_email: string
  from_name?: string
}

// ---------------------------------------------------------------------------
// Bulk send types (exported for callers)
// ---------------------------------------------------------------------------

export type BulkEmailEntry = {
  to: string
  subject: string
  htmlContent: string
  from?: string
  fromName?: string
}

export type BulkSendSuccess = {
  email: string
  referenceId: string
}

export type BulkSendResult = {
  successful: BulkSendSuccess[]
  failed: { email: string; error: string }[]
}

// ---------------------------------------------------------------------------
// Provider service
// ---------------------------------------------------------------------------

class MailerooNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "maileroo"
  protected client_: MailerooClientType | null = null
  protected readonly options: MailerooOptions
  protected readonly logger: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: MailerooOptions
  ) {
    super()
    this.options = options
    this.logger = logger
  }

  protected async getClient(): Promise<MailerooClientType> {
    if (!this.client_) {
      const { MailerooClient } = await mailerooImport
      this.client_ = new MailerooClient(this.options.api_key)
    }
    return this.client_
  }

  protected async emailAddress(email: string, name?: string) {
    const { EmailAddress } = await mailerooImport
    return new EmailAddress(email, name)
  }

  static validateOptions(options: Record<any, any>) {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `api_key` is required in the Maileroo provider's options."
      )
    }
    if (!options.from_email) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `from_email` is required in the Maileroo provider's options."
      )
    }
  }

  // -------------------------------------------------------------------------
  // Standard single-email send (called by Medusa's notification module)
  // -------------------------------------------------------------------------

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    const templateData = notification.data as any

    // If already sent via bulk API, skip
    if (templateData?._already_sent) {
      const externalId = templateData._external_id || "bulk-sent"
      this.logger.info(
        `Maileroo: Skipping send for ${notification.to} — already sent (id: ${externalId})`
      )
      return { id: String(externalId) }
    }

    let htmlContent: string | null = null
    let subject = "We have a message for you"
    let fromEmail = this.options.from_email
    let fromName = this.options.from_name || "Jaal Yantra Textiles"

    if (
      templateData?._template_html_content &&
      templateData?._template_processed
    ) {
      htmlContent = templateData._template_html_content
      subject = templateData._template_subject || subject
      fromEmail = templateData._template_from || fromEmail
      this.logger.info(
        `Maileroo: Using processed template for ${notification.template} with from: ${fromEmail}`
      )
    } else {
      this.logger.warn(
        `Maileroo: No processed template for "${notification.template}", using data as HTML`
      )
      htmlContent =
        templateData?.html || templateData?.message || "No content available"
    }

    // Allow per-notification from override (for partner+handle@ pattern)
    if (templateData?._partner_from_email) {
      fromEmail = templateData._partner_from_email
    }
    if (templateData?._partner_from_name) {
      fromName = templateData._partner_from_name
    }

    try {
      const client = await this.getClient()
      const referenceId = await client.sendBasicEmail({
        from: await this.emailAddress(fromEmail, fromName),
        to: [await this.emailAddress(notification.to)],
        subject,
        html: htmlContent || "No content",
      })

      this.logger.info(
        `Maileroo: Email sent to ${notification.to} (ref: ${referenceId})`
      )
      return { id: String(referenceId) }
    } catch (error) {
      this.logger.error("Maileroo: Failed to send email", error)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send email via Maileroo: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // -------------------------------------------------------------------------
  // Bulk send (called directly by workflows/jobs)
  // -------------------------------------------------------------------------

  async sendBulk(entries: BulkEmailEntry[]): Promise<BulkSendResult> {
    const defaultFrom = this.options.from_email
    const defaultName = this.options.from_name || "Jaal Yantra Textiles"

    const successful: BulkSendSuccess[] = []
    const failed: { email: string; error: string }[] = []

    // Maileroo supports up to 500 per bulk call
    const BATCH_SIZE = 500

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE)

      try {
        const bulkClient = await this.getClient()
        const bulkMessages: any[] = []
        for (const entry of batch) {
          bulkMessages.push({
            from: await this.emailAddress(
              entry.from || defaultFrom,
              entry.fromName || defaultName
            ),
            to: await this.emailAddress(entry.to),
            template_data: {
              _html_content: entry.htmlContent,
            },
          })
        }
        const referenceIds = await bulkClient.sendBulkEmails({
          subject: batch[0].subject, // Bulk API uses a shared subject
          html: "{{{_html_content}}}",  // Use template passthrough
          messages: bulkMessages,
        })

        // Map results back to entries
        const refIds = Array.isArray(referenceIds)
          ? referenceIds
          : [referenceIds]

        for (let j = 0; j < batch.length; j++) {
          successful.push({
            email: batch[j].to,
            referenceId: refIds[j] || "unknown",
          })
        }
      } catch (error) {
        // If bulk fails, fall back to individual sends
        for (const entry of batch) {
          try {
            const fallbackClient = await this.getClient()
            const refId = await fallbackClient.sendBasicEmail({
              from: await this.emailAddress(
                entry.from || defaultFrom,
                entry.fromName || defaultName
              ),
              to: [await this.emailAddress(entry.to)],
              subject: entry.subject,
              html: entry.htmlContent,
            })

            successful.push({ email: entry.to, referenceId: String(refId) })
          } catch (innerErr) {
            failed.push({
              email: entry.to,
              error:
                innerErr instanceof Error
                  ? innerErr.message
                  : String(innerErr),
            })
          }
        }
      }

      // Delay between batches
      if (i + BATCH_SIZE < entries.length) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }

    this.logger.info(
      `Maileroo bulk: ${successful.length} sent, ${failed.length} failed (${entries.length} total)`
    )

    return { successful, failed }
  }
}

export default MailerooNotificationProviderService
