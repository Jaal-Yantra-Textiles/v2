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

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    let htmlContent: string | null = null
    let subject = "We have a message for you"
    let fromEmail = this.options.from_email
    let fromName = this.options.from_name || "Jaal Yantra Textiles"

    const templateData = notification.data as any
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
              From: {
                Email: fromEmail,
                Name: fromName,
              },
              To: [
                {
                  Email: notification.to,
                },
              ],
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
}

export default MailjetNotificationProviderService
