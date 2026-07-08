import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { TestEmailResult } from "../types"
import {
  buildEmailData,
  convertContentToHtml,
} from "../utils/build-email-data"
import { sendNotificationEmailWorkflow } from "../../../email/send-notification-email"

export const sendTestEmailStepId = "send-test-email"

/**
 * This step sends a test email of a blog post to a specified email address.
 * It uses the notification module to send the email and converts TipTap content to HTML.
 *
 * The test email renders the same redesigned `blog-subscriber` template — and the
 * same email data payload — as the production subscriber send, so what you see in
 * the test inbox is exactly what subscribers will receive.
 *
 * @example
 * const result = sendTestEmailStep({
 *   email: "test@example.com",
 *   blogData: {...},
 *   subject: "Test Blog Email",
 *   customMessage: "This is a test email"
 * })
 */
interface SendTestEmailInput {
  email: string
  blogData: any
  subject: string
  customMessage?: string
}

export const sendTestEmailStep = createStep(
  sendTestEmailStepId,
  async (input: SendTestEmailInput, { container }) => {
    if (!input.email) {
      console.error('Email address is undefined or empty')
      return new StepResponse({
        success: false,
        email: 'undefined',
        error: 'Email address is required but was not provided'
      } as TestEmailResult)
    }

    console.log(`Sending test email to ${input.email}`)

    try {
      // Convert TipTap content to HTML via the shared helper
      let htmlContent = ''
      try {
        htmlContent = convertContentToHtml(input.blogData.content)
        console.log('Converted blog content to HTML')
      } catch (contentError) {
        console.warn(`Failed to convert content to HTML: ${contentError.message}`)
        htmlContent = String(input.blogData.content || 'No content available')
      }

      // Build the same email data payload used by the production subscriber
      // send so the test renders the redesigned template identically (UTM-tagged
      // links, personal note, two-doors CTAs, unsubscribe URL, etc.).
      const emailData = buildEmailData(
        {
          id: "test-user",
          email: input.email,
          first_name: "Test",
          last_name: "User",
        },
        input.blogData,
        htmlContent,
        {
          subject: input.subject,
          customMessage: input.customMessage,
        },
        { isTest: true }
      )

      // Send email using the email template workflow
      await sendNotificationEmailWorkflow(container).run({
        input: {
          to: input.email,
          template: "blog-subscriber",
          data: emailData
        }
      })

      console.log(`Successfully sent test email to ${input.email}`)

      return new StepResponse({
        success: true,
        email: input.email
      } as TestEmailResult)
    } catch (error) {
      console.error(`Failed to send test email to ${input.email}: ${error.message}`)

      return new StepResponse({
        success: false,
        email: input.email,
        error: error.message || "Unknown error"
      } as TestEmailResult)
    }
  }
)
