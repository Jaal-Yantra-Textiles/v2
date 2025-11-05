import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { refetchPartnerForThisAdmin } from "../../../helpers";
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
    const adminId = req.auth_context?.actor_id;
    
    if (!adminId) {
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
        // Fetch the partner associated with this admin
        const partner = await refetchPartnerForThisAdmin(adminId, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        console.log("Adding comment - Partner ID:", partner.id, "Admin ID:", adminId, "Task ID:", taskId);
        
        // Verify the task is assigned to this partner
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: taskData } = await query.index({
            entity: 'task',
            fields: ["*", "partners.*"],
            filters: {
                partners: { id: partner.id },
                id: taskId
            }
        });

        if (!taskData || taskData.length === 0) {
            return res.status(403).json({ 
                message: "Task not assigned to this partner or does not exist" 
            });
        }

        const task = taskData[0];

        // Get admin details for author name
        const admin = partner.admins?.find((a) => a && a.id === adminId);
        const authorName = admin 
            ? [admin.first_name, admin.last_name].filter(Boolean).join(" ") || admin.email
            : "Partner Admin";

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

        console.log("Comment added successfully:", newComment.id);

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
    const adminId = req.auth_context?.actor_id;
    
    if (!adminId) {
        return res.status(401).json({ 
            message: "Partner authentication required" 
        });
    }

    try {
        // Fetch the partner associated with this admin
        const partner = await refetchPartnerForThisAdmin(adminId, req.scope);
        
        if (!partner) {
            throw new MedusaError(
                MedusaError.Types.UNAUTHORIZED, 
                "No partner associated with this admin"
            );
        }

        // Verify the task is assigned to this partner
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        const { data: taskData } = await query.index({
            entity: 'task',
            fields: ["*", "partners.*"],
            filters: {
                partners: { id: partner.id },
                id: taskId
            }
        });

        if (!taskData || taskData.length === 0) {
            return res.status(403).json({ 
                message: "Task not assigned to this partner or does not exist" 
            });
        }

        const task = taskData[0];
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
