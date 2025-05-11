import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "zod";
import { sendBlogSubscribersWorkflow } from "../../../../../../../workflows/blogs/send-blog-subscribers";
import { WEBSITE_MODULE } from "../../../../../../../modules/website";
import WebsiteService from "../../../../../../../modules/website/service";

// Define the validation schema for the request body
export const SendBlogSubscriptionSchema = z.object({
  subject: z.string().optional(),
  customMessage: z.string().optional(),
});

export type SendBlogSubscriptionRequest = z.infer<typeof SendBlogSubscriptionSchema>;

/**
 * POST /admin/websites/:id/pages/:pageId/subs
 * 
 * Sends a blog post to all subscribers using the long-running workflow.
 * This endpoint validates that the page exists, is a blog, and is published
 * before starting the workflow.
 */
export const POST = async (
  req: MedusaRequest<SendBlogSubscriptionRequest>,
  res: MedusaResponse
) => {
  const { id: websiteId, pageId } = req.params;
  const { subject, customMessage } = req.validatedBody || {};
  
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
        error: "Only blog pages can be sent to subscribers"
      });
    }
    
    // Check if the page is published
    if (page.status !== "Published") {
      return res.status(400).json({
        message: "Blog not published",
        error: "Only published blogs can be sent to subscribers"
      });
    }
    
    // Start the workflow to send the blog to subscribers
    const { result, transaction } = await sendBlogSubscribersWorkflow(req.scope)
      .run({
        input: {
          page_id: pageId,
          subject: subject || `New Blog: ${page.title}`,
          customMessage: customMessage || "",
        },
      });
    
    // Return success response with workflow ID and confirmation instructions
    return res.status(200).json({
      message: "Blog sending process initiated. Confirmation required to proceed.",
      workflow_id: transaction.transactionId,
      page_id: pageId,
      website_id: websiteId,
      requires_confirmation: true,
      confirmation_url: `/admin/websites/${websiteId}/pages/${pageId}/subs/${transaction.transactionId}/confirm`,
      subscribers: result.totalSubscribers
    });
  } catch (error) {
    console.error("Error sending blog to subscribers:", error);
    
    return res.status(500).json({
      message: "Failed to send blog to subscribers",
      error: error.message || "An unexpected error occurred"
    });
  }
};


