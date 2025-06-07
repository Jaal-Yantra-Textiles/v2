import {
  WorkflowData,
  WorkflowResponse,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import {
  fetchBlogDataStep,
  sendTestEmailStep,
  sendTestEmailStepId
} from "../steps"
import { TestBlogEmailInput, TestEmailResult } from "../types"

export const sendTestBlogEmailWorkflowId = "send-test-blog-email"

/**
 * This workflow sends a test email of a blog post to a specified email address.
 * 
 * It's useful for previewing how the blog post will look in an email before
 * sending it to all subscribers.
 * 
 * @example
 * To send a test blog email:
 * 
 * ```ts
 * const { result } = await sendTestBlogEmailWorkflow(container)
 * .run({
 *   input: {
 *     page_id: "blog_123",
 *     test_email: "test@example.com",
 *     subject: "Test: Check out our latest blog post!",
 *     customMessage: "This is a test email preview."
 *   }
 * })
 * ```
 * 
 * @summary
 * 
 * Send a test email of a blog post to a specified email address.
 */
export const sendTestBlogEmailWorkflow = createWorkflow(
  sendTestBlogEmailWorkflowId,
  (
    input: WorkflowData<TestBlogEmailInput>
  ): WorkflowResponse<TestEmailResult> => {
    // Step 1: Fetch blog data
    const blogData = fetchBlogDataStep(input)
    
    // Prepare data for test email step
    const testEmailData = transform({ input, blogData }, (data) => {
      // Validate that test_email exists
      if (!data.input.test_email) {
        console.error('test_email is missing in workflow input')
      }
      
      return {
        email: data.input.test_email,
        blogData: data.blogData,
        subject: data.input.subject || `New Blog: ${data.blogData?.title || 'Blog Post'}`,
        customMessage: data.input.customMessage
      }
    })
    
    // Step 2: Send test email
    const testEmailResult = sendTestEmailStep(testEmailData)
    
    // Return the result
    return new WorkflowResponse(testEmailResult)
  }
)
