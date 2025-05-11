import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SubscriberBatch, EmailSendingResult } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"

export const processSubscriberBatchStepId = "process-subscriber-batch"

/**
 * This step processes a batch of subscribers, sending the blog post to each one.
 * It handles errors for individual subscribers and continues processing the batch.
 * It uses the notification module to send emails and converts TipTap content to HTML.
 *
 * @example
 * const results = processSubscriberBatchStep({ 
 *   subscribers: [...], 
 *   blogData: {...}, 
 *   emailConfig: { subject: "New Blog", customMessage: "Check out our latest post" } 
 * })
 */
export const processSubscriberBatchStep = createStep(
  processSubscriberBatchStepId,
  async (batch: SubscriberBatch, { container }) => {
    const { subscribers, blogData, emailConfig } = batch
    
    console.log(`Processing batch with ${subscribers.length} subscribers`)
    
    // Use the notification module instead of notification service
    const notificationModuleService = container.resolve(Modules.NOTIFICATION)
    
    const results: EmailSendingResult[] = []
    
    // Process each subscriber in the batch
    for (const subscriber of subscribers) {
      try {
        console.log(`Sending email to ${subscriber.email} (${subscriber.id})`)
        
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
            first_name: subscriber.first_name || "",
            last_name: subscriber.last_name || "",
            email: subscriber.email,
            id: subscriber.id
          },
          subject: emailConfig.subject,
          custom_message: emailConfig.customMessage || ""
        }
        
        // Send email using notification module (similar to password reset)
        await notificationModuleService.createNotifications({
          to: subscriber.email,
          channel: "email",
          template: process.env.SENDGRID_BLOG_SUBSCRIPTION_TEMPLATE || "d-blog-subscription-template",
          data: {
            ...emailData,
          }
        })
        
        // Record successful send
        results.push({
          success: true,
          subscriber_id: subscriber.id,
          email: subscriber.email
        })
        
        console.log(`Successfully sent email to ${subscriber.email}`)
      } catch (error) {
        console.error(`Failed to send email to ${subscriber.email}: ${error.message}`)
        
        // Record failed send but continue with next subscriber
        results.push({
          success: false,
          subscriber_id: subscriber.id,
          email: subscriber.email,
          error: error.message || "Unknown error"
        })
      }
      
      // Add a small delay to avoid overwhelming the email service
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Summarize batch results
    const successCount = results.filter(r => r.success).length
    const failureCount = results.filter(r => !r.success).length
    
    console.log(`Batch processing complete. Success: ${successCount}, Failed: ${failureCount}`)
    
    return new StepResponse(results)
  }
)
