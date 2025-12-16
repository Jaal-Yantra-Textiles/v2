import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SubscriberBatch, EmailSendingResult, SendingSummary } from "../types"
import { Modules } from "@medusajs/framework/utils"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"
import { INotificationModuleService } from "@medusajs/types"

export const processAllBatchesStepId = "process-all-batches"

/**
 * This step processes all subscriber batches sequentially.
 * It calls the processSubscriberBatchStep for each batch and combines the results.
 *
 * @example
 * const sendingSummary = processAllBatchesStep(batches)
 */
export const processAllBatchesStep = createStep(
  processAllBatchesStepId,
  async (batches: SubscriberBatch[], { container }) => {
    
    const allResults: EmailSendingResult[] = []
    
    // Process each batch sequentially
    for (const batch of batches) {
      const { subscribers, blogData, emailConfig } = batch

      // Use the notification module
      const notificationModuleService:INotificationModuleService = container.resolve(Modules.NOTIFICATION)
      
      // Process each subscriber in the batch
      for (const subscriber of subscribers) {
        try {
          
          // Convert TipTap content to HTML
          let htmlContent = ''
          try {
            // blogData.content now contains the extracted TipTap content from the blog block
            const content = blogData.content
            
            // Handle different content formats
            if (typeof content === 'object') {
              // If content is already a parsed object
              htmlContent = convertTipTapToHtml(content)
            } else if (typeof content === 'string') {
              // If content is a JSON string
              if (content.includes('"type":"doc"') || content.startsWith('{')) {
                try {
                  // Try to parse the JSON string
                  const parsedContent = JSON.parse(content)
                  htmlContent = convertTipTapToHtml(parsedContent)
                } catch (parseError) {
                  // If parsing fails, try to convert the string directly
                  htmlContent = convertTipTapToHtml(content)
                }
              } else {
                // If it's plain text, use it as is
                htmlContent = content
              }
            } else {
              // Fallback for any other content type
              htmlContent = String(content || '')
            }
          } catch (contentError) {
            // Fall back to a safe default
            htmlContent = String(blogData.content || 'No content available')
          }
          
          // Prepare email data - flattened structure for SendGrid compatibility
          const emailData = {
            // Blog data at root level
            blog_title: blogData.title,
            blog_content: htmlContent,
            blog_url: `${process.env.FRONTEND_URL || ''}${blogData.url}`,
            blog_created_at: blogData.created_at,
            blog_updated_at: blogData.updated_at,
            blog_tags: blogData.tags || [],
            
            // Person data at root level
            first_name: subscriber.first_name || "",
            last_name: subscriber.last_name || "",
            email: subscriber.email,
            subscriber_id: subscriber.id,
            
            // Email metadata
            subject: emailConfig.subject,
            custom_message: emailConfig.customMessage || "",
            
            // Additional template data
            unsubscribe_url: `${process.env.FRONTEND_URL || ''}/unsubscribe?id=${subscriber.id}`,
            website_url: process.env.FRONTEND_URL || '',
            current_year: new Date().getFullYear().toString(),
            
            // Also include nested objects for backward compatibility if needed
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
            }
          }
          
          // Send email using notification module
          await notificationModuleService.createNotifications({
            to: subscriber.email,
            channel: "email",
            template: process.env.SENDGRID_BLOG_SUBSCRIPTION_TEMPLATE || "d-blog-subscription-template",
            data: emailData
          })
          
          // Record successful send
          allResults.push({
            success: true,
            subscriber_id: subscriber.id,
            email: subscriber.email
          })
          
        } catch (error) {
          
          allResults.push({
            success: false,
            subscriber_id: subscriber.id,
            email: subscriber.email,
            error: error.message || "Unknown error"
          })
        }
        
        // Add a small delay to avoid overwhelming the email service
        await new Promise(resolve => setTimeout(resolve, 100))
      }
    }
    
    // Calculate statistics
    const sentList = allResults
      .filter(result => result.success)
      .map(result => ({ 
        subscriber_id: result.subscriber_id, 
        email: result.email 
      }))
    
    const failedList = allResults
      .filter(result => !result.success)
      .map(result => ({ 
        subscriber_id: result.subscriber_id, 
        email: result.email,
        error: result.error || "Unknown error"
      }))
    
    const summary: SendingSummary = {
      totalSubscribers: allResults.length,
      sentCount: sentList.length,
      failedCount: failedList.length,
      sentList,
      failedList,
      sentAt: new Date().toISOString()
    }
    
    // Return a single summary object, not an array
    return new StepResponse(summary)
  }
)
