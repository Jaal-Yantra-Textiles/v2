import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromActorId } from "../../../../../helpers";
import { TASKS_MODULE } from "../../../../../../../modules/tasks";
import TaskService from "../../../../../../../modules/tasks/service";

/**
 * POST /partners/assigned-tasks/[taskId]/subtasks/[subtaskId]/complete
 * Mark a subtask as completed
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const { taskId, subtaskId } = req.params;
  const actorId = req.auth_context?.actor_id;
  
  if (!actorId) {
    return res.status(401).json({ 
      error: "Partner authentication required - no actor ID" 
    });
  }

  try {
    const partner = await getPartnerFromActorId(actorId, req.scope);
    
    if (!partner) {
      return res.status(401).json({ 
        error: "Partner authentication required - no partner found" 
      });
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
    
    // Verify parent task is assigned to this partner
    const { data: taskData } = await query.index({
      entity: 'task',
      fields: ["*", "partners.*"],
      filters: {
        id: taskId
      }
    });

    if (!taskData || taskData.length === 0) {
      return res.status(404).json({ 
        error: "Task not found" 
      });
    }

    const task = taskData[0] as any;
    
    // Check if task is linked to this partner
    const isLinked = task.partners && Array.isArray(task.partners) && 
                     task.partners.some((p: any) => p.id === partner.id);
    
    if (!isLinked) {
      return res.status(403).json({ 
        error: "Task not assigned to this partner" 
      });
    }

    const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
    
    // First, verify parent task is accepted
    const parentTask = await taskService.retrieveTask(taskId);
    
    if (!parentTask) {
      return res.status(404).json({ error: "Parent task not found" });
    }

    if (parentTask.status !== "accepted" && parentTask.status !== "in_progress") {
      return res.status(400).json({ 
        error: "Parent task must be accepted before completing subtasks",
        parent_status: parentTask.status
      });
    }

    // Verify subtask belongs to parent task
    const subtask = await taskService.retrieveTask(subtaskId, {
      relations: ["parent_task"],
    });

    if (!subtask) {
      return res.status(404).json({ error: "Subtask not found" });
    }

    if (subtask.parent_task?.id !== taskId) {
      return res.status(400).json({ 
        error: "Subtask does not belong to this task" 
      });
    }

    // Update subtask status to completed
    const updatedSubtask = await taskService.updateTasks({
      id: subtaskId,
      status: "completed",
      completed_at: new Date(),
    });

    // Check if all subtasks are completed - refetch parent with subtasks
    const parentTaskWithSubtasks = await taskService.retrieveTask(taskId, {
      relations: ["subtasks"],
    });

    const allSubtasksCompleted = parentTaskWithSubtasks.subtasks?.every(
      (st) => st.status === "completed"
    ) || false;

    let parentCompleted = false;

    // If all subtasks are completed, complete the parent task
    if (allSubtasksCompleted && (parentTaskWithSubtasks as any).status !== "completed") {
      await taskService.updateTasks({
        id: taskId,
        status: "completed",
        completed_at: new Date(),
      });
      parentCompleted = true;
    }

    res.status(200).json({
      subtask: updatedSubtask,
      parent_completed: parentCompleted,
      message: parentCompleted 
        ? "Subtask completed and all tasks finished!" 
        : "Subtask completed successfully",
    });
  } catch (error) {
    console.error("Error completing subtask:", error);
    res.status(500).json({ 
      error: "Failed to complete subtask",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}
