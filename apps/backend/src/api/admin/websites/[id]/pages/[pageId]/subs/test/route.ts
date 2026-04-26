/**
 * @api {post} /admin/websites/:id/pages/:pageId/subs/test Send Test Blog Email
 * @apiName SendTestBlogEmail
 * @apiGroup Website Pages
 * @apiDescription Sends a test email of a blog post to a specified email address.
 * This endpoint validates that the page exists, is a blog, and is published before sending the test email.
 *
 * @apiParam {String} id Website ID
 * @apiParam {String} pageId Page ID
 *
 * @apiBody {String} email Email address to send the test blog to
 * @apiBody {String} [subject] Custom subject for the email
 * @apiBody {String} [customMessage] Custom message to include in the email
 *
 * @apiSuccess {String} message Success message
 * @apiSuccess {String} page_id ID of the blog page
 * @apiSuccess {String} website_id ID of the website
 * @apiSuccess {String} email Email address the test was sent to
 * @apiSuccess {Boolean} success Whether the email was sent successfully
 * @apiSuccess {String} [error] Error message if any
 *
 * @apiError {String} message Error message
 * @apiError {String} error Detailed error information
 *
 * @apiExample {curl} Example usage:
 * curl -X POST "http://localhost:9000/admin/websites/website_123/pages/page_456/subs/test" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "email": "test@example.com",
 *     "subject": "Check out our new blog!",
 *     "customMessage": "This is a test email for our latest blog post."
 *   }'
 *
 * @apiExample {javascript} JavaScript Example:
 * const response = await fetch(
 *   "http://localhost:9000/admin/websites/website_123/pages/page_456/subs/test",
 *   {
 *     method: "POST",
 *     headers: {
 *       "Content-Type": "application/json",
 *     },
 *     body: JSON.stringify({
 *       email: "test@example.com",
 *       subject: "Check out our new blog!",
 *       customMessage: "This is a test email for our latest blog post."
 *     }),
 *   }
 * );
 * const data = await response.json();
 *
 * @apiExample {typescript} TypeScript Example:
 * interface TestBlogEmailRequest {
 *   email: string;
 *   subject?: string;
 *   customMessage?: string;
 * }
 *
 * const sendTestBlogEmail = async (
 *   websiteId: string,
 *   pageId: string,
 *   request: TestBlogEmailRequest
 * ): Promise<{
 *   message: string;
 *   page_id: string;
 *   website_id: string;
 *   email: string;
 *   success: boolean;
 *   error?: string;
 * }> => {
 *   const response = await fetch(
 *     `http://localhost:9000/admin/websites/${websiteId}/pages/${pageId}/subs/test`,
 *     {
 *       method: "POST",
 *       headers: {
 *         "Content-Type": "application/json",
 *       },
 *       body: JSON.stringify(request),
 *     }
 *   );
 *   return response.json();
 * };
 *
 * // Usage:
 * sendTestBlogEmail("website_123", "page_456", {
 *   email: "test@example.com",
 *   subject: "Check out our new blog!",
 *   customMessage: "This is a test email for our latest blog post."
 * });
 *
 * @apiSuccessExample {json} Success Response:
 * {
 *   "message": "Test email sent successfully",
 *   "page_id": "page_456",
 *   "website_id": "website_123",
 *   "email": "test@example.com",
 *   "success": true
 * }
 *
 * @apiErrorExample {json} Page Not Found:
 * {
 *   "message": "Page not found",
 *   "error": "The specified page does not exist"
 * }
 *
 * @apiErrorExample {json} Invalid Page Type:
 * {
 *   "message": "Invalid page type",
 *   "error": "Only blog pages can be sent as test emails"
 * }
 *
 * @apiErrorExample {json} Blog Not Published:
 * {
 *   "message": "Blog not published",
 *   "error": "Only published blogs can be sent as test emails"
 * }
 *
 * @apiErrorExample {json} Server Error:
 * {
 *   "message": "Failed to send test blog email",
 *   "error": "An unexpected error occurred"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "@medusajs/framework/zod";
import { sendTestBlogEmailWorkflow } from "../../../../../../../../workflows/blogs/send-blog-subscribers";
import { WEBSITE_MODULE } from "../../../../../../../../modules/website";
import WebsiteService from "../../../../../../../../modules/website/service";

// Define the validation schema for the request body
export const TestBlogEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
  subject: z.string().optional(),
  customMessage: z.string().optional(),
});

export type TestBlogEmailRequest = z.infer<typeof TestBlogEmailSchema>;

/**
 * POST /admin/websites/:id/pages/:pageId/subs/test
 * 
 * Sends a test email of a blog post to a specified email address.
 * This endpoint validates that the page exists, is a blog, and is published
 * before sending the test email.
 */
export const POST = async (
  req: MedusaRequest<TestBlogEmailRequest>,
  res: MedusaResponse
) => {
  const { id: websiteId, pageId } = req.params;
  const { email, subject, customMessage } = req.validatedBody || {};
  
  try {
    // Get the website service to verify the page exists
    const websiteService = req.scope.resolve(WEBSITE_MODULE) as WebsiteService;
    
    // Retrieve the page to verify it exists and is a blog
    const page = await websiteService.retrievePage(pageId, {
      relations: ["blocks"]
    });
    
    if (!page) {
      return res.status(404).json({
        message: "Page not found",
        error: "The specified page does not exist"
      });
    }
    
    // Verify it's a blog page
    if (page.page_type !== "Blog") {
      return res.status(400).json({
        message: "Invalid page type",
        error: "Only blog pages can be sent as test emails"
      });
    }
    
    // Check if the page is published
    if (page.status !== "Published") {
      return res.status(400).json({
        message: "Blog not published",
        error: "Only published blogs can be sent as test emails"
      });
    }
    
    // Start the workflow to send a test email
    const { result } = await sendTestBlogEmailWorkflow(req.scope)
      .run({
        input: {
          page_id: pageId,
          test_email: email, // This is the correct parameter name expected by the workflow
          subject: subject || `New Blog: ${page.title}`,
          customMessage: customMessage || "",
        },
      });
    
    // Return success response
    return res.status(200).json({
      message: "Test email sent successfully",
      page_id: pageId,
      website_id: websiteId,
      email: email,
      success: result.success,
      error: result.error
    });
  } catch (error) {
    console.error("Error sending test blog email:", error);
    
    return res.status(500).json({
      message: "Failed to send test blog email",
      error: error.message || "An unexpected error occurred"
    });
  }
};
