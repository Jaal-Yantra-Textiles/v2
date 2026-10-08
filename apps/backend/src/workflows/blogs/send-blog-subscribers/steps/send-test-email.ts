import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { TestEmailResult } from "../types"
import { buildEmailData } from "../utils/build-email-data"
import { resolveBlogEmailHtml } from "../utils/email-html"
import { sendNotificationEmailWorkflow } from "../../../email/send-notification-email"

export const sendTestEmailStepId = "send-test-email"

/**
 * Who a test send is addressed to. A preview goes to "Test User"; a send by
 * hand to a real reader (catching up someone who missed the broadcast) is
 * greeted by their name and carries their id, so the template's
 * "Hello {{first_name}}" and unsubscribe link are theirs. Before this every
 * test send said "Hello Test".
 */
export function testSendSubscriber(
  email: string,
  recipient?: { id: string; first_name?: string | null; last_name?: string | null }
) {
  return recipient
    ? {
        id: recipient.id,
        email,
        first_name: recipient.first_name || "",
        last_name: recipient.last_name || "",
      }
    : { id: "test-user", email, first_name: "Test", last_name: "User" }
}

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
  /** A real reader (see TestBlogEmailInput.recipient); absent for a preview. */
  recipient?: { id: string; first_name?: string | null; last_name?: string | null }
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
        htmlContent = resolveBlogEmailHtml(input.blogData)
        console.log('Converted blog content to HTML')
      } catch (contentError) {
        console.warn(`Failed to convert content to HTML: ${contentError.message}`)
        htmlContent = String(input.blogData.content || 'No content available')
      }

      // Build the same email data payload used by the production subscriber
      // send so the test renders the redesigned template identically (UTM-tagged
      // links, personal note, two-doors CTAs, unsubscribe URL, etc.).
      const emailData = buildEmailData(
        testSendSubscriber(input.email, input.recipient),
        input.blogData,
        htmlContent,
        {
          subject: input.subject,
          customMessage: input.customMessage,
        },
        { isTest: !input.recipient }
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
