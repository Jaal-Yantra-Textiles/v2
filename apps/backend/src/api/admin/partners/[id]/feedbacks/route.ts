/**
 * @file Admin API routes for managing partner feedbacks
 * @description Provides endpoints for retrieving and creating feedbacks associated with partners in the JYT Commerce platform
 * @module API/Admin/Partners/Feedbacks
 */

/**
 * @typedef {Object} FeedbackInput
 * @property {string} title - The title of the feedback
 * @property {string} content - The detailed content of the feedback
 * @property {string} rating - The rating given in the feedback (e.g., "positive", "neutral", "negative")
 * @property {string} author - The author of the feedback
 * @property {string} [email] - Optional email of the author
 */

/**
 * @typedef {Object} FeedbackResponse
 * @property {string} id - The unique identifier of the feedback
 * @property {string} title - The title of the feedback
 * @property {string} content - The detailed content of the feedback
 * @property {string} rating - The rating given in the feedback
 * @property {string} author - The author of the feedback
 * @property {string} [email] - Optional email of the author
 * @property {Date} created_at - When the feedback was created
 * @property {Date} updated_at - When the feedback was last updated
 * @property {Object} link_to - The associated partner details
 * @property {string} link_to.partner_id - The ID of the linked partner
 */

/**
 * @typedef {Object} FeedbackListResponse
 * @property {FeedbackResponse[]} feedbacks - Array of feedback objects
 * @property {number} count - Total count of feedbacks
 */

/**
 * List all feedbacks for a specific partner
 * @route GET /admin/partners/:id/feedbacks
 * @group Partner - Operations related to partners
 * @param {string} id.path.required - The ID of the partner to retrieve feedbacks for
 * @returns {FeedbackListResponse} 200 - List of feedbacks associated with the partner
 * @throws {MedusaError} 404 - Partner not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/partners/partner_123456789/feedbacks
 *
 * @example response 200
 * {
 *   "feedbacks": [
 *     {
 *       "id": "fb_123456789",
 *       "title": "Great Service",
 *       "content": "The partner provided excellent service and support.",
 *       "rating": "positive",
 *       "author": "John Doe",
 *       "email": "john.doe@example.com",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "link_to": {
 *         "partner_id": "partner_123456789"
 *       }
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new feedback for a specific partner
 * @route POST /admin/partners/:id/feedbacks
 * @group Partner - Operations related to partners
 * @param {string} id.path.required - The ID of the partner to associate the feedback with
 * @param {FeedbackInput} request.body.required - Feedback data to create
 * @returns {Object} 201 - Created feedback object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/partners/partner_123456789/feedbacks
 * {
 *   "title": "Excellent Collaboration",
 *   "content": "The partner was very responsive and delivered high-quality work.",
 *   "rating": "positive",
 *   "author": "Jane Smith",
 *   "email": "jane.smith@example.com"
 * }
 *
 * @example response 201
 * {
 *   "feedback": {
 *     "id": "fb_987654321",
 *     "title": "Excellent Collaboration",
 *     "content": "The partner was very responsive and delivered high-quality work.",
 *     "rating": "positive",
 *     "author": "Jane Smith",
 *     "email": "jane.smith@example.com",
 *     "created_at": "2023-01-02T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "link_to": {
 *       "partner_id": "partner_123456789"
 *     }
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createFeedbackWithLinkWorkflow } from "../../../../../workflows/feedback/create-feedback-with-link";
import { Feedback } from "../../../feedbacks/validators";

/**
 * GET /admin/partners/[id]/feedbacks
 * Lists all feedbacks linked to a specific partner
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const partnerId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Query all feedbacks linked to this partner
    const { data: partnerData } = await query.index({
      entity: "partner",
      fields: ["feedbacks.*"],
      filters: {
        id: partnerId,
      },
    });

    // Extract the feedbacks from the partner object
    const feedbacks =
      partnerData && partnerData.length > 0 && partnerData[0].feedbacks
        ? partnerData[0].feedbacks
        : [];

    return res.json({
      feedbacks: feedbacks,
      count: feedbacks.length,
    });
  } catch (error) {
    console.error("Error fetching partner feedbacks:", error);
    return res.status(500).json({
      message: "Failed to fetch partner feedbacks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /admin/partners/[id]/feedbacks
 * Creates a new feedback and links it to the partner
 */
export const POST = async (
  req: MedusaRequest<Feedback>,
  res: MedusaResponse
) => {
  const partnerId = req.params.id;

  try {
    const { result } = await createFeedbackWithLinkWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        link_to: {
          partner_id: partnerId,
        },
      },
    });

    return res.status(201).json({
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error creating partner feedback:", error);
    return res.status(500).json({
      message: "Failed to create partner feedback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
