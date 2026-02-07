/**
 * @file Partner API routes for managing task comments
 * @description Provides endpoints for partners to add and retrieve comments on assigned tasks in the JYT Commerce platform
 * @module API/Partner/TaskComments
 */

/**
 * @typedef {Object} TaskComment
 * @property {string} id - Unique identifier for the comment
 * @property {string} comment - The comment text content
 * @property {"partner"|"admin"} author_type - Type of author (partner or admin)
 * @property {string} author_id - ID of the author
 * @property {string} author_name - Name of the author
 * @property {string} created_at - ISO 8601 timestamp when comment was created
 */

/**
 * @typedef {Object} TaskMetadata
 * @property {TaskComment[]} [comments] - Array of comments associated with the task
 * @property {Record<string, unknown>} [workflow_config] - Additional workflow configuration
 */

/**
 * @typedef {Object} AddCommentRequest
 * @property {string} comment.required - The comment text to add (must be non-empty string)
 */

/**
 * @typedef {Object} AddCommentResponse
 * @property {string} message - Success message
 * @property {TaskComment} comment - The newly created comment
 * @property {Object} task - The updated task object
 */

/**
 * @typedef {Object} GetCommentsResponse
 * @property {TaskComment[]} comments - Array of comments sorted by creation date (newest first)
 * @property {number} count - Total number of comments
 */

/**
 * Partner adds a comment to a task
 * @route POST /partners/assigned-tasks/:taskId/comments
 * @group TaskComments - Operations related to task comments
 * @param {string} taskId.path.required - ID of the task to comment on
 * @param {AddCommentRequest} request.body.required - Comment data to add
 * @returns {AddCommentResponse} 200 - Successfully added comment
 * @throws {MedusaError} 400 - Invalid comment text
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Task not found or not assigned to partner
 * @throws {MedusaError} 500 - Failed to add comment
 *
 * @example request
 * POST /partners/assigned-tasks/task_123456789/comments
 * {
 *   "comment": "I've completed the design draft and uploaded it to the shared folder."
 * }
 *
 * @example response 200
 * {
 *   "message": "Comment added successfully",
 *   "comment": {
 *     "id": "comment_1678901234567_abc123def",
 *     "comment": "I've completed the design draft and uploaded it to the shared folder.",
 *     "author_type": "partner",
 *     "author_id": "partner_123456789",
 *     "author_name": "Partner",
 *     "created_at": "2023-03-15T14:30:45.678Z"
 *   },
 *   "task": {
 *     "id": "task_123456789",
 *     "metadata": {
 *       "comments": [...],
 *       "workflow_config": {...}
 *     }
 *   }
 * }
 */

/**
 * Get all comments for a task
 * @route GET /partners/assigned-tasks/:taskId/comments
 * @group TaskComments - Operations related to task comments
 * @param {string} taskId.path.required - ID of the task to retrieve comments for
 * @returns {GetCommentsResponse} 200 - List of comments for the task
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 404 - Task not found or not assigned to partner
 * @throws {MedusaError} 500 - Failed to fetch comments
 *
 * @example request
 * GET /partners/assigned-tasks/task_123456789/comments
 *
 * @example response 200
 * {
 *   "comments": [
 *     {
 *       "id": "comment_1678901234567_abc123def",
 *       "comment": "I've completed the design draft and uploaded it to the shared folder.",
 *       "author_type": "partner",
 *       "author_id": "partner_123456789",
 *       "author_name": "Partner",
 *       "created_at": "2023-03-15T14:30:45.678Z"
 *     },
 *     {
 *       "id": "comment_1678897654321_ghi789jkl",
 *       "comment": "Please review the requirements document before starting.",
 *       "author_type": "admin",
 *       "author_id": "admin_987654321",
 *       "author_name": "Admin User",
 *       "created_at": "2023-03-14T10:15:30.123Z"
 *     }
 *   ],
 *   "count": 2
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../../../helpers";
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
    workflow_config?: Record<string, unknown>
    [key: string]: unknown
}

/**
 * POST /partners/assigned-tasks/[taskId]/comments
 * Partner adds a comment to a task
 */
export async function POST(
    req: AuthenticatedMedusaRequest<{ comment: string }>,
    res: MedusaResponse
) {
    const taskId = req.params.taskId;
    const actorId = req.auth_context?.actor_id;
    
    if (!actorId) {
        return res.status(401).json({ 
            message: "Partner authentication required" 
        });
    }

    const { comment } = req.body;

    if (!comment || typeof comment !== 'string' || comment.trim().length === 0) {
        return res.status(400).json({
            message: "Comment text is required"
        });
    }

    try {
        const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        // Verify the task is assigned to this partner (or its parent is)
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        
        // First, fetch the task to check if it's a subtask
        const { data: taskData } = await query.index({
            entity: 'task',
            fields: ["*", "partners.*"],
            filters: {
                id: taskId
            }
        });

        if (!taskData || taskData.length === 0) {
            return res.status(404).json({ 
                message: "Task not found" 
            });
        }

        const task = taskData[0] as any;
        
        // Check if this task or its parent is linked to the partner
        let isAuthorized = false;
        
        // Check if task is directly linked to partner
        if (task.partners && Array.isArray(task.partners) && task.partners.some((p: any) => p.id === partner.id)) {
            isAuthorized = true;
        }
        
        // If not, check if it's a subtask and its parent is linked to partner
        if (!isAuthorized && task.parent_task_id) {
            const { data: parentTaskData } = await query.index({
                entity: 'task',
                fields: ["*", "partners.*"],
                filters: {
                    id: task.parent_task_id
                }
            });
            
            const parentTask = parentTaskData?.[0] as any

            if (
                parentTask?.partners &&
                Array.isArray(parentTask.partners) &&
                parentTask.partners.some((p: any) => p.id === partner.id)
            ) {
                isAuthorized = true
            }
        }
        
        if (!isAuthorized) {
            return res.status(404).json({ 
                message: "Task not found" 
            });
        }

        // Get admin details for author name
        const authorName = "Partner";

        // Prepare new comment
        const newComment: TaskComment = {
            id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            comment: comment.trim(),
            author_type: "partner",
            author_id: partner.id,
            author_name: authorName,
            created_at: new Date().toISOString()
        };

        // Get existing metadata and comments
        const existingMetadata = ((task as any).metadata || {}) as TaskMetadata;
        const existingComments = existingMetadata.comments || [];

        // Update task with new comment
        const tasksService = req.scope.resolve<TaskService>(TASKS_MODULE);
        const updatedTask = await tasksService.updateTasks({
            id: taskId,
            metadata: {
                ...existingMetadata,
                comments: [...existingComments, newComment]
            }
        });

        res.status(200).json({ 
            message: "Comment added successfully",
            comment: newComment,
            task: updatedTask
        });
    } catch (error) {
        console.error("Error adding comment:", error);
        res.status(500).json({ 
            message: "Failed to add comment",
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

/**
 * GET /partners/assigned-tasks/[taskId]/comments
 * Get all comments for a task
 */
export async function GET(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const taskId = req.params.taskId;
    const actorId = req.auth_context?.actor_id;
    
    if (!actorId) {
        return res.status(401).json({ 
            message: "Partner authentication required" 
        });
    }

    try {
        const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        // Verify the task is assigned to this partner (or its parent is)
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        
        // First, fetch the task to check if it's a subtask
        const { data: taskData } = await query.index({
            entity: 'task',
            fields: ["*", "partners.*"],
            filters: {
                id: taskId
            }
        });

        if (!taskData || taskData.length === 0) {
            return res.status(404).json({ 
                message: "Task not found" 
            });
        }

        const task = taskData[0] as any;
        
        // Check if this task or its parent is linked to the partner
        let isAuthorized = false;
        
        // Check if task is directly linked to partner
        if (task.partners && Array.isArray(task.partners) && task.partners.some((p: any) => p.id === partner.id)) {
            isAuthorized = true;
        }
        
        // If not, check if it's a subtask and its parent is linked to partner
        if (!isAuthorized && task.parent_task_id) {
            const { data: parentTaskData } = await query.index({
                entity: 'task',
                fields: ["*", "partners.*"],
                filters: {
                    id: task.parent_task_id
                }
            });
            
            const parentTask = parentTaskData?.[0] as any

            if (
                parentTask?.partners &&
                Array.isArray(parentTask.partners) &&
                parentTask.partners.some((p: any) => p.id === partner.id)
            ) {
                isAuthorized = true
            }
        }
        
        if (!isAuthorized) {
            return res.status(404).json({ 
                message: "Task not found" 
            });
        }
        const metadata = ((task as any).metadata || {}) as TaskMetadata;
        const comments = metadata.comments || [];

        // Sort comments by created_at (newest first)
        const sortedComments = [...comments].sort((a, b) => 
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        res.status(200).json({ 
            comments: sortedComments,
            count: sortedComments.length
        });
    } catch (error) {
        console.error("Error fetching comments:", error);
        res.status(500).json({ 
            message: "Failed to fetch comments",
            error: error instanceof Error ? error.message : String(error)
        });
    }
}
