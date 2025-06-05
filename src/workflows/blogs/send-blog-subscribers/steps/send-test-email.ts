import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { TestEmailResult } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"

export const sendTestEmailStepId = "send-test-email"

/**
 * This step sends a test email of a blog post to a specified email address.
 * It uses the notification module to send the email and converts TipTap content to HTML.
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
    console.log(`Sending test email to ${email}`)
    
    // Use the notification module
    const notificationModuleService = container.resolve(Modules.NOTIFICATION)
    
    try {
      // Convert TipTap content to HTML if it's in JSON format
      let htmlContent = blogData.content
      try {
        // Check if content is TipTap JSON
        if (typeof blogData.content === 'string' && 
            (blogData.content.startsWith('{') || blogData.content.includes('"type":"doc"'))) {
          htmlContent = convertTipTapToHtml(blogData.content)
        }
      } catch (error) {
        console.warn(`Failed to convert TipTap content to HTML: ${error.message}`)
        // Fall back to original content
        htmlContent = blogData.content
      }
      
      // Prepare email data
      const emailData = {
        blog: {
          title: blogData.title,
          content: htmlContent,
          url: `${process.env.FRONTEND_URL || ''}${blogData.url}`,
          created_at: blogData.created_at,
          updated_at: blogData.updated_at,
          tags: blogData.tags || []
        },
        person: {
          first_name: "Test",
          last_name: "User",
          email: email,
          id: "test-user"
        },
        subject: subject,
        custom_message: customMessage || "",
        is_test: true // Flag to indicate this is a test email
      }
      
      // Send email using notification module
      await notificationModuleService.createNotifications({
        to: email,
        channel: "email",
        template: process.env.SENDGRID_BLOG_SUBSCRIPTION_TEMPLATE || "d-blog-subscription-template",
        data: {
          ...emailData,
        }
      })
      
      console.log(`Successfully sent test email to ${email}`)
      
      // Return success result
      return new StepResponse({
        success: true,
        email: email
      } as TestEmailResult)
    } catch (error) {
      console.error(`Failed to send test email to ${email}: ${error.message}`)
      
      // Return error result
      return new StepResponse({
        success: false,
        email: email,
        error: error.message || "Unknown error"
      } as TestEmailResult)
    }
  }
)
