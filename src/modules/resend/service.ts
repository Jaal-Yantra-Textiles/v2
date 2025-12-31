import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { Resend } from "resend"
import React from "react"
import DefaultEmail from "./templates/default-email"

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

  constructor(
    { logger }: InjectedDependencies,
    options: ResendOptions
  ) {
    super()
    this.resendClient = new Resend(options.api_key)
    this.options = options
    this.logger = logger
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
      // No processed template found - use default React template with data as-is
      this.logger.info(`No processed template found for ${notification.template}, using default template`)
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
      this.logger.error("Failed to send email", error)
      // Re-throw the error to properly mark notification as failed
      throw error
    }
  }
}

export default ResendNotificationProviderService
