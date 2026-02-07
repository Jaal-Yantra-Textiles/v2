/**
 * @file Admin API routes for managing task comments
 * @description Provides endpoints for adding and retrieving comments on tasks in the JYT Commerce platform
 * @module API/Admin/Tasks/Comments
 */

/**
 * @typedef {Object} TaskComment
 * @property {string} id - Unique identifier for the comment
 * @property {string} comment - The comment text
 * @property {"partner"|"admin"} author_type - Type of author (partner or admin)
 * @property {string} author_id - ID of the author
 * @property {string} author_name - Name of the author
 * @property {string} created_at - ISO timestamp when comment was created
 */

/**
 * @typedef {Object} TaskCommentInput
 * @property {string} comment.required - The comment text to add
 */

/**
 * @typedef {Object} TaskCommentResponse
 * @property {Object} task - Updated task object
 * @property {string} task.id - Task ID
 * @property {Object} task.metadata - Task metadata
 * @property {TaskComment[]} task.metadata.comments - Array of comments
 * @property {TaskComment} comment - The newly created comment
 */

/**
 * @typedef {Object} TaskCommentsListResponse
 * @property {TaskComment[]} comments - Array of comments for the task
 */

/**
 * Add a comment to a task
 * @route POST /admin/tasks/:id/comments
 * @group Task Comments - Operations related to task comments
 * @param {string} id.path.required - Task ID
 * @param {TaskCommentInput} request.body.required - Comment data to add
 * @returns {TaskCommentResponse} 200 - Successfully added comment
 * @throws {MedusaError} 400 - Invalid comment text or missing authentication
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/tasks/task_123456789/comments
 * {
 *   "comment": "This task needs to be completed by Friday"
 * }
 *
 * @example response 200
 * {
 *   "task": {
 *     "id": "task_123456789",
 *     "metadata": {
 *       "comments": [
 *         {
 *           "id": "comment_1678901234567_abc123",
 *           "comment": "This task needs to be completed by Friday",
 *           "author_type": "admin",
 *           "author_id": "usr_987654321",
 *           "author_name": "John Doe",
 *           "created_at": "2023-03-15T10:30:45.123Z"
 *         }
 *       ]
 *     }
 *   },
 *   "comment": {
 *     "id": "comment_1678901234567_abc123",
 *     "comment": "This task needs to be completed by Friday",
 *     "author_type": "admin",
 *     "author_id": "usr_987654321",
 *     "author_name": "John Doe",
 *     "created_at": "2023-03-15T10:30:45.123Z"
 *   }
 * }
 */

/**
 * Get all comments for a task
 * @route GET /admin/tasks/:id/comments
 * @group Task Comments - Operations related to task comments
 * @param {string} id.path.required - Task ID
 * @returns {TaskCommentsListResponse} 200 - List of task comments
 * @throws {MedusaError} 404 - Task not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/tasks/task_123456789/comments
 *
 * @example response 200
 * {
 *   "comments": [
 *     {
 *       "id": "comment_1678901234567_abc123",
 *       "comment": "This task needs to be completed by Friday",
 *       "author_type": "admin",
 *       "author_id": "usr_987654321",
 *       "author_name": "John Doe",
 *       "created_at": "2023-03-15T10:30:45.123Z"
 *     },
 *     {
 *       "id": "comment_1678901234568_def456",
 *       "comment": "I've assigned this to the design team",
 *       "author_type": "admin",
 *       "author_id": "usr_123456789",
 *       "author_name": "Jane Smith",
 *       "created_at": "2023-03-15T11:15:22.456Z"
 *     }
 *   ]
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

type TaskComment = {
    id: string
    comment: string
    author_type: "partner" | "admin"
    author_id: string
    author_name: string
    created_at: string
}

type TaskMetadata = {
    comments?: TaskComment[]
    [key: string]: unknown
}

/**
 * POST /admin/tasks/[id]/comments
 * Admin adds a comment to a task
 */
export async function POST(
    req: AuthenticatedMedusaRequest<{ comment: string }>,
    res: MedusaResponse
) {
    const taskId = req.params.id;
    const adminId = req.auth_context?.actor_id;
    
    if (!adminId) {
        return res.status(401).json({ 
            message: "Admin authentication required" 
        });
    }

    const { comment } = req.body;

    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return res.status(400).json({
            message: "Comment text is required"
        });
    }

    try {
        const taskService: TaskService = req.scope.resolve(TASKS_MODULE);

        // Fetch the task
        const task = await taskService.retrieveTask(taskId, {
            select: ["id", "title", "metadata"]
        });

        if (!task) {
            throw new MedusaError(
                MedusaError.Types.NOT_FOUND,
                `Task with id ${taskId} not found`
            );
        }

        // Get existing metadata and comments
        const existingMetadata = (task.metadata as TaskMetadata) || {};
        const existingComments = existingMetadata.comments || [];

        // Get admin user info for the comment
        const userService = req.scope.resolve("user");
        let adminName = "Admin";
        
        try {
            const adminUser = await userService.retrieveUser(adminId);
            if (adminUser) {
                adminName = adminUser.first_name && adminUser.last_name 
                    ? `${adminUser.first_name} ${adminUser.last_name}`
                    : adminUser.email || "Admin";
            }
        } catch (error) {
            // If we can't fetch admin info, use default
            console.warn("Could not fetch admin user info:", error);
        }

        // Create new comment
        const newComment: TaskComment = {
            id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            comment: comment.trim(),
            author_type: "admin",
            author_id: adminId,
            author_name: adminName,
            created_at: new Date().toISOString()
        };

        // Add comment to the array
        const updatedComments = [...existingComments, newComment];

        // Update task metadata
        const updatedTask = await taskService.updateTasks({
            id: taskId,
            metadata: {
                ...existingMetadata,
                comments: updatedComments
            }
        });

        return res.status(200).json({
            task: updatedTask,
            comment: newComment
        });

    } catch (error) {
        if (error instanceof MedusaError) {
            return res.status(error.type === MedusaError.Types.NOT_FOUND ? 404 : 400).json({
                message: error.message
            });
        }
        
        console.error("Error adding comment to task:", error);
        return res.status(500).json({
            message: "Failed to add comment to task"
        });
    }
}

/**
 * GET /admin/tasks/[id]/comments
 * Get all comments for a task
 */
export async function GET(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const taskId = req.params.id;

    try {
        const taskService: TaskService = req.scope.resolve(TASKS_MODULE);

        // Fetch the task
        const task = await taskService.retrieveTask(taskId, {
            select: ["id", "metadata"]
        });

        if (!task) {
            throw new MedusaError(
                MedusaError.Types.NOT_FOUND,
                `Task with id ${taskId} not found`
            );
        }

        // Get comments from metadata
        const metadata = (task.metadata as TaskMetadata) || {};
        const comments = metadata.comments || [];

        return res.status(200).json({
            comments
        });

    } catch (error) {
        if (error instanceof MedusaError) {
            return res.status(error.type === MedusaError.Types.NOT_FOUND ? 404 : 400).json({
                message: error.message
            });
        }
        
        console.error("Error fetching task comments:", error);
        return res.status(500).json({
            message: "Failed to fetch task comments"
        });
    }
}
