import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "zod";
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
