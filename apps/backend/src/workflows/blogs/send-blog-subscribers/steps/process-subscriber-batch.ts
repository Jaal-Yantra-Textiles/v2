import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { SubscriberBatch, EmailSendingResult } from "../types"
import { convertTipTapToHtml } from "../utils/tiptap-to-html"
import { sendNotificationEmailWorkflow } from "../../../email/send-notification-email"

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
    
    // Use the send-notification-email workflow with blog-subscriber template
    
    const results: EmailSendingResult[] = []
    
    // Process each subscriber in the batch
    for (const subscriber of subscribers) {
      try {
        console.log(`Sending email to ${subscriber.email} (${subscriber.id})`)
        
        // Convert TipTap content to HTML if it's in JSON format
        let htmlContent = blogData.content
        try {
          // Check if content is TipTap JSON
          if (typeof blogData.content === 'string') {
            if (blogData.content.includes('"type":"doc"') || blogData.content.startsWith('{')) {
              try {
                // Try to parse the JSON string
                const parsedContent = JSON.parse(blogData.content)
                htmlContent = convertTipTapToHtml(parsedContent)
                console.log('Converted TipTap JSON string to HTML')
              } catch (parseError) {
                // If parsing fails, try to convert the string directly
                htmlContent = convertTipTapToHtml(blogData.content)
                console.log('Converted TipTap string to HTML (fallback)')
              }
            } else {
              // If it's plain text, use it as is
              htmlContent = blogData.content
              console.log('Using plain text content')
            }
          } else {
            // Fallback for any other content type
            htmlContent = String(blogData.content || '')
            console.log('Using fallback string conversion for content')
          }
        } catch (contentError) {
          console.warn(`Failed to convert content to HTML: ${contentError.message}`)
          // Fall back to a safe default
          htmlContent = String(blogData.content || 'No content available')
        }
        
        // Prepare email data for the blog-subscriber template
        const emailData = {
          // Blog data at root level for template variables
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
          
          // Additional template data
          unsubscribe_url: `${process.env.FRONTEND_URL || ''}/unsubscribe?id=${subscriber.id}`,
          website_url: process.env.FRONTEND_URL || '',
          current_year: new Date().getFullYear().toString(),
          
          // Include nested objects for template compatibility
          blog: {
            title: blogData.title,
            content: htmlContent,
            url: `${process.env.FRONTEND_URL || ''}${blogData.url}`,
            created_at: blogData.created_at,
            updated_at: blogData.updated_at,
            tags: blogData.tags || [],
          },
          person: {
            first_name: subscriber.first_name || "",
            last_name: subscriber.last_name || "",
            email: subscriber.email,
            id: subscriber.id
          }
        }
        
        // Send email using the new email template workflow
        await sendNotificationEmailWorkflow(container).run({
          input: {
            to: subscriber.email,
            template: "blog-subscriber",
            data: emailData
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
