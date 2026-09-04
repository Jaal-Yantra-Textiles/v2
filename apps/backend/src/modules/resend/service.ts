import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { Resend } from "resend"
import React from "react"
import DefaultEmail from "./templates/default-email"
import {
  classifyRecipient,
  botSuppressionLog,
  BOT_SUPPRESSED_SEND_ID,
} from "../../lib/bot-recipients"
import {
  createSuppressionGuard,
} from "../../lib/email-suppression-lookup"

type InjectedDependencies = {
  logger: Logger
}

type ResendOptions = {
  api_key: string
  from: string
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "resend"
  protected readonly resendClient: Resend
  protected readonly options: ResendOptions
  protected readonly logger: Logger
  protected readonly suppressionGuard: ReturnType<typeof createSuppressionGuard>

  constructor(
    deps: InjectedDependencies,
    options: ResendOptions
  ) {
    super()
    const { logger } = deps
    this.resendClient = new Resend(options.api_key)
    this.options = options
    this.logger = logger
    this.suppressionGuard = createSuppressionGuard({
      // `__pg_connection__` is in the provider container; the suppression MODULE
      // is not (probed — see email-suppression-lookup.ts). #1339
      pg: (deps as any).__pg_connection__,
      logger,
      provider: "resend",
      channel: (options as any).channels?.[0] ?? "email",
    })
  }

  static validateOptions(options: Record<any, any>) {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `api_key` is required in the provider's options."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Option `from` is required in the provider's options."
      )
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    // Bot-recipient guard (#1333). Every email that leaves the platform passes
    // through a provider, so this is the one place the policy cannot be bypassed
    // by a new caller. Suppress, don't block — see src/lib/bot-recipients.ts.
    const botVerdict = classifyRecipient(notification.to)
    if (botVerdict.bot) {
      this.logger.warn(
        botSuppressionLog("resend", notification.to, notification.template, botVerdict)
      )
      return { id: BOT_SUPPRESSED_SEND_ID }
    }

    // Suppression ledger (#1339). Separate from the bot guard above: that one is
    // a pure domain rule, this one asks what the ledger says about this address
    // on THIS channel. Fails open and logs loudly — see the lookup module.
    const suppression = await this.suppressionGuard(
      notification.to,
      notification.template
    )
    if (suppression.suppress) {
      return { id: suppression.id }
    }

    let template: string | null = null
    let subject = "We have a message for you"
    let fromAddress = this.options.from // Default to environment variable

    // Check if processed template data was passed from workflow
    const templateData = notification.data as any
    if (templateData?._template_html_content && templateData?._template_processed) {
      template = templateData._template_html_content
      subject = templateData._template_subject || subject
      fromAddress = templateData._template_from || fromAddress

      this.logger.info(`Using processed database template for ${notification.template} with from: ${fromAddress}`)
    } else {
      // No processed template found — log a warning but still proceed.
      // The default React template is only used for system notifications
      // (password reset, order confirmation etc.) that don't have a DB template.
      // For newsletter/blog emails, the workflow should always attach _template_* data.
      this.logger.warn(
        `No processed database template found for "${notification.template}". ` +
        `Falling back to default template. If this is a newsletter email, ` +
        `ensure the email template exists in the database with is_active=true.`
      )
    }

    const commonOptions = {
      from: fromAddress,
      to: [notification.to],
      subject,
    }

    let emailOptions: any
    if (template && typeof template === "string") {
      // Use the pre-processed HTML template directly
      emailOptions = {
        ...commonOptions,
        html: template,
      }
    } else {
      // Use default React template with all data (filtered)
      const filteredData = notification.data ? 
        Object.keys(notification.data)
          .filter(key => !key.startsWith('_template_'))
          .reduce((obj, key) => {
            obj[key] = (notification.data as any)[key]
            return obj
          }, {} as Record<string, any>) : {}
      
      emailOptions = {
        ...commonOptions,
        react: React.createElement(DefaultEmail, {
          subject,
          title: filteredData.title || "Jaal Yantra Textiles",
          message: filteredData.message || "Thank you for choosing Jaal Yantra Textiles.",
          data: filteredData,
        }),
      }
    }

    try {
      const { data, error } = await this.resendClient.emails.send(emailOptions)

      if (error || !data) {
        const responseError: any = error
        const errorCode =
          responseError?.code ??
          responseError?.name ??
          responseError?.statusCode ??
          responseError?.status_code ??
          "unknown"

        ;(notification as any).provider_data = {
          ...(((notification as any).provider_data || {}) as Record<string, any>),
          error: {
            code: errorCode,
            message: responseError?.message ?? "unknown error",
          },
          failed_at: new Date().toISOString(),
        }

        if (error) {
          this.logger.error("Failed to send email", error)
        } else {
          this.logger.error("Failed to send email: unknown error")
        }

        throw new MedusaError(
          MedusaError.Types.UNEXPECTED_STATE,
          `Failed to send email: ${errorCode} - ${
            responseError?.message ?? "unknown error"
          }`
        )
      }

      this.logger.info(`Email sent successfully with ID: ${data.id}`)
      return {
        id: data.id,
      }
    } catch (error) {
      ;(notification as any).provider_data = {
        ...(((notification as any).provider_data || {}) as Record<string, any>),
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
        failed_at: new Date().toISOString(),
      }
      this.logger.error("Failed to send email")
      // Re-throw the error to properly mark notification as failed
      throw error
    }
  }
}

export default ResendNotificationProviderService
