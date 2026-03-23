import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import Mailjet from "node-mailjet"

type InjectedDependencies = {
  logger: Logger
}

type MailjetOptions = {
  api_key: string
  secret_key: string
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
}

export type BulkSendSuccess = {
  email: string
  messageId: string
  messageUuid: string
  status: string
}

export type BulkSendResult = {
  successful: BulkSendSuccess[]
  failed: { email: string; error: string }[]
}

// ---------------------------------------------------------------------------
// Provider service
// ---------------------------------------------------------------------------

const MAILJET_BATCH_SIZE = 50

class MailjetNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "mailjet"
  protected readonly mailjetClient: ReturnType<typeof Mailjet.apiConnect>
  protected readonly options: MailjetOptions
  protected readonly logger: Logger

  constructor(
    { logger }: InjectedDependencies,
    options: MailjetOptions
  ) {
    super()
    this.mailjetClient = Mailjet.apiConnect(options.api_key, options.secret_key)
    this.options = options
    this.logger = logger
  }

  static validateOptions(options: Record<any, any>) {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `api_key` is required in the Mailjet provider's options."
      )
    }
    if (!options.secret_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `secret_key` is required in the Mailjet provider's options."
      )
    }
    if (!options.from_email) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `from_email` is required in the Mailjet provider's options."
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

    // If the email was already sent via bulk API, skip sending and just return
    // the external ID so Medusa still creates the notification record.
    if (templateData?._already_sent) {
      const externalId = templateData._external_id || "bulk-sent"
      this.logger.info(`Mailjet: Skipping send for ${notification.to} — already sent (id: ${externalId})`)
      return { id: String(externalId) }
    }

    let htmlContent: string | null = null
    let subject = "We have a message for you"
    let fromEmail = this.options.from_email
    let fromName = this.options.from_name || "Jaal Yantra Textiles"

    if (templateData?._template_html_content && templateData?._template_processed) {
      htmlContent = templateData._template_html_content
      subject = templateData._template_subject || subject
      fromEmail = templateData._template_from || fromEmail
      this.logger.info(`Mailjet: Using processed template for ${notification.template} with from: ${fromEmail}`)
    } else {
      this.logger.info(`Mailjet: No processed template found for ${notification.template}, using data as HTML`)
      htmlContent = templateData?.html || templateData?.message || "No content available"
    }

    try {
      const result = await this.mailjetClient
        .post("send", { version: "v3.1" })
        .request({
          Messages: [
            {
              From: { Email: fromEmail, Name: fromName },
              To: [{ Email: notification.to }],
              Subject: subject,
              HTMLPart: htmlContent || "No content",
            },
          ],
        })

      const body = (result.body as any)
      const messageResult = body?.Messages?.[0]

      if (messageResult?.Status === "error") {
        const errorMsg = messageResult.Errors?.[0]?.ErrorMessage || "Unknown Mailjet error"
        this.logger.error(`Mailjet: Failed to send email - ${errorMsg}`)
        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Failed to send email via Mailjet: ${errorMsg}`
        )
      }

      const messageId = messageResult?.To?.[0]?.MessageID?.toString() ||
                         messageResult?.To?.[0]?.MessageUUID ||
                         "unknown"

      this.logger.info(`Mailjet: Email sent successfully with ID: ${messageId}`)
      return { id: messageId }
    } catch (error) {
      if (error instanceof MedusaError) {
        throw error
      }
      this.logger.error("Mailjet: Failed to send email", error)
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to send email via Mailjet: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  // -------------------------------------------------------------------------
  // Bulk send (called directly by workflows/jobs, NOT via notification module)
  // -------------------------------------------------------------------------

  /**
   * Send emails in bulk via Mailjet's v3.1 API.
   * Chunks into groups of 50 (Mailjet's per-call limit) and sends each chunk
   * as a single API call with multiple Messages.
   *
   * Uses the same client instance and from address configured for this provider.
   */
  async sendBulk(entries: BulkEmailEntry[]): Promise<BulkSendResult> {
    const fromEmail = this.options.from_email
    const fromName = this.options.from_name || "Jaal Yantra Textiles"

    const successful: BulkSendSuccess[] = []
    const failed: { email: string; error: string }[] = []

    for (let i = 0; i < entries.length; i += MAILJET_BATCH_SIZE) {
      const batch = entries.slice(i, i + MAILJET_BATCH_SIZE)

      const messages = batch.map((entry) => ({
        From: { Email: fromEmail, Name: fromName },
        To: [{ Email: entry.to }],
        Subject: entry.subject,
        HTMLPart: entry.htmlContent,
      }))

      try {
        const result = await this.mailjetClient
          .post("send", { version: "v3.1" })
          .request({ Messages: messages })

        const body = result.body as any
        const responseMessages = body?.Messages || []

        for (let j = 0; j < responseMessages.length; j++) {
          const msg = responseMessages[j]
          if (msg.Status === "error") {
            failed.push({
              email: batch[j].to,
              error: msg.Errors?.[0]?.ErrorMessage || "Unknown Mailjet error",
            })
          } else {
            const recipient = msg.To?.[0] || {}
            successful.push({
              email: batch[j].to,
              messageId: String(recipient.MessageID || ""),
              messageUuid: String(recipient.MessageUUID || ""),
              status: msg.Status || "success",
            })
          }
        }
      } catch (error) {
        for (const entry of batch) {
          failed.push({
            email: entry.to,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      // Small delay between batch API calls to avoid rate limiting
      if (i + MAILJET_BATCH_SIZE < entries.length) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }

    this.logger.info(
      `Mailjet bulk: ${successful.length} sent, ${failed.length} failed (${entries.length} total)`
    )

    return { successful, failed }
  }
}

export default MailjetNotificationProviderService
