/**
 * @file Admin API routes for managing task feedbacks
 * @description Provides endpoints for listing and creating feedbacks linked to specific tasks in the JYT Commerce platform
 * @module API/Admin/Tasks/Feedbacks
 */

/**
 * @typedef {Object} FeedbackInput
 * @property {string} content - The content of the feedback
 * @property {string} rating - The rating given in the feedback (e.g., "positive", "neutral", "negative")
 * @property {string} [author_id] - The ID of the user who provided the feedback
 * @property {string} [author_name] - The name of the user who provided the feedback
 * @property {string} [author_email] - The email of the user who provided the feedback
 */

/**
 * @typedef {Object} FeedbackResponse
 * @property {string} id - The unique identifier of the feedback
 * @property {string} content - The content of the feedback
 * @property {string} rating - The rating given in the feedback
 * @property {string} author_id - The ID of the user who provided the feedback
 * @property {string} author_name - The name of the user who provided the feedback
 * @property {string} author_email - The email of the user who provided the feedback
 * @property {Date} created_at - When the feedback was created
 * @property {Date} updated_at - When the feedback was last updated
 * @property {Object} link_to - The task the feedback is linked to
 * @property {string} link_to.task_id - The ID of the linked task
 */

/**
 * @typedef {Object} FeedbackListResponse
 * @property {FeedbackResponse[]} feedbacks - Array of feedback objects
 * @property {number} count - Total number of feedbacks returned
 */

/**
 * List all feedbacks linked to a specific task
 * @route GET /admin/tasks/:id/feedbacks
 * @group Task Feedbacks - Operations related to task feedbacks
 * @param {string} id.path.required - The ID of the task to fetch feedbacks for
 * @returns {FeedbackListResponse} 200 - List of feedbacks linked to the task
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/tasks/task_123456789/feedbacks
 *
 * @example response 200
 * {
 *   "feedbacks": [
 *     {
 *       "id": "fb_123456789",
 *       "content": "Great job on the design!",
 *       "rating": "positive",
 *       "author_id": "usr_123456789",
 *       "author_name": "John Doe",
 *       "author_email": "john@example.com",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "link_to": {
 *         "task_id": "task_123456789"
 *       }
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new feedback and link it to a specific task
 * @route POST /admin/tasks/:id/feedbacks
 * @group Task Feedbacks - Operations related to task feedbacks
 * @param {string} id.path.required - The ID of the task to link the feedback to
 * @param {FeedbackInput} request.body.required - Feedback data to create
 * @returns {Object} 201 - Created feedback object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/tasks/task_123456789/feedbacks
 * {
 *   "content": "Excellent work on the project!",
 *   "rating": "positive",
 *   "author_id": "usr_123456789",
 *   "author_name": "Jane Smith",
 *   "author_email": "jane@example.com"
 * }
 *
 * @example response 201
 * {
 *   "feedback": {
 *     "id": "fb_987654321",
 *     "content": "Excellent work on the project!",
 *     "rating": "positive",
 *     "author_id": "usr_123456789",
 *     "author_name": "Jane Smith",
 *     "author_email": "jane@example.com",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "link_to": {
 *       "task_id": "task_123456789"
 *     }
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { createFeedbackWithLinkWorkflow } from "../../../../../workflows/feedback/create-feedback-with-link";
import { Feedback } from "../../../feedbacks/validators";

/**
 * GET /admin/tasks/[id]/feedbacks
 * Lists all feedbacks linked to a specific task
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const taskId = req.params.id;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  try {
    // Query all feedbacks linked to this task
    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["feedbacks.*"],
      filters: {
        id: taskId,
      },
    });

    // Extract the feedbacks from the task object
    const feedbacks =
      taskData && taskData.length > 0 && taskData[0].feedbacks
        ? taskData[0].feedbacks
        : [];

    return res.json({
      feedbacks: feedbacks,
      count: feedbacks.length,
    });
  } catch (error) {
    console.error("Error fetching task feedbacks:", error);
    return res.status(500).json({
      message: "Failed to fetch task feedbacks",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * POST /admin/tasks/[id]/feedbacks
 * Creates a new feedback and links it to the task
 */
export const POST = async (
  req: MedusaRequest<Feedback>,
  res: MedusaResponse
) => {
  const taskId = req.params.id;

  try {
    const { result } = await createFeedbackWithLinkWorkflow(req.scope).run({
      input: {
        ...req.validatedBody,
        link_to: {
          task_id: taskId,
        },
      },
    });

    return res.status(201).json({
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error creating task feedback:", error);
    return res.status(500).json({
      message: "Failed to create task feedback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
