import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { TestEmailResult } from "../types"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"
import { sendNotificationEmailWorkflow } from "../../../email/send-notification-email"

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
    // Validate that email is defined and not empty
    if (!input.email) {
      console.error('Email address is undefined or empty')
      return new StepResponse({
        success: false,
        email: 'undefined',
        error: 'Email address is required but was not provided'
      } as TestEmailResult)
    }
    
    console.log(`Sending test email to ${input.email}`)
    
    // Use the send-notification-email workflow with blog-subscriber template
    
    try {
      // Convert TipTap content to HTML
      let htmlContent = ''
      try {
        // blogData.content now contains the extracted TipTap content from the blog block
        const content = input.blogData.content
        
        // Handle different content formats
        if (typeof content === 'object') {
          // If content is already a parsed object
          htmlContent = convertTipTapToHtml(content)
          console.log('Converted TipTap object to HTML')
        } else if (typeof content === 'string') {
          // If content is a JSON string
          if (content.includes('"type":"doc"') || content.startsWith('{')) {
            try {
              // Try to parse the JSON string
              const parsedContent = JSON.parse(content)
              htmlContent = convertTipTapToHtml(parsedContent)
              console.log('Converted TipTap JSON string to HTML')
            } catch (parseError) {
              // If parsing fails, try to convert the string directly
              htmlContent = convertTipTapToHtml(content)
              console.log('Converted TipTap string to HTML (fallback)')
            }
          } else {
            // If it's plain text, use it as is
            htmlContent = content
            console.log('Using plain text content')
          }
        } else {
          // Fallback for any other content type
          htmlContent = String(content || '')
          console.log('Using fallback string conversion for content')
        }
      } catch (contentError) {
        console.warn(`Failed to convert content to HTML: ${contentError.message}`)
        // Fall back to a safe default
        htmlContent = String(input.blogData.content || 'No content available')
      }
      
      // Prepare email data for the blog-subscriber template
      const emailData = {
        // Blog data at root level for template variables
        blog_title: input.blogData.title,
        blog_content: htmlContent,
        blog_url: `${process.env.FRONTEND_URL || ''}${input.blogData.url}`,
        blog_created_at: input.blogData.created_at,
        blog_updated_at: input.blogData.updated_at,
        blog_tags: input.blogData.tags || [],
        
        // Person data at root level
        first_name: "Test",
        last_name: "User",
        email: input.email,
        subscriber_id: "test-user",
        
        // Additional template data
        unsubscribe_url: `${process.env.FRONTEND_URL || ''}/unsubscribe?id=test-user`,
        website_url: process.env.FRONTEND_URL || '',
        current_year: new Date().getFullYear().toString(),
        is_test: true, // Flag to indicate this is a test email
        
        // Include nested objects for template compatibility
        blog: {
          title: input.blogData.title,
          content: htmlContent,
          url: `${process.env.FRONTEND_URL || ''}${input.blogData.url}`,
          created_at: input.blogData.created_at,
          updated_at: input.blogData.updated_at,
          tags: input.blogData.tags || [],
        },
        person: {
          first_name: "Test",
          last_name: "User",
          email: input.email,
          id: "test-user",
        }
      }
      
      // Send email using the new email template workflow
      await sendNotificationEmailWorkflow(container).run({
        input: {
          to: input.email,
          template: "blog-subscriber",
          data: emailData
        }
      })
      
      console.log(`Successfully sent test email to ${input.email}`)
      
      // Return success result
      return new StepResponse({
        success: true,
        email: input.email
      } as TestEmailResult)
    } catch (error) {
      console.error(`Failed to send test email to ${input.email}: ${error.message}`)
      
      // Return error result
      return new StepResponse({
        success: false,
        email: input.email,
        error: error.message || "Unknown error"
      } as TestEmailResult)
    }
  }
)
