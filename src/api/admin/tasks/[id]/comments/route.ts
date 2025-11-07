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
