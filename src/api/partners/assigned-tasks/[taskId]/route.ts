import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromAuthContext } from "../../helpers";
import { TASKS_MODULE } from "../../../../modules/tasks";
import TaskService from "../../../../modules/tasks/service";

/**
 * GET /partners/assigned-tasks/[taskId]
 * Fetch a single task assigned to the authenticated partner.
 */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const { taskId } = req.params;
  const actorId = req.auth_context?.actor_id;

  if (!actorId) {
    return res.status(401).json({
      error: "Partner authentication required - no actor ID",
    });
  }

  try {
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope);

    if (!partner) {
      return res.status(401).json({
        error: "Partner authentication required - no partner found",
      });
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["*", "partners.*"],
      filters: {
        id: taskId,
      },
    });

    if (!taskData || taskData.length === 0) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    const task = taskData[0] as any;

    const isLinked =
      task.partners &&
      Array.isArray(task.partners) &&
      task.partners.some((p: any) => p.id === partner.id);

    if (!isLinked) {
      return res.status(403).json({
        error: "Task not assigned to this partner",
      });
    }

    const taskService: TaskService = req.scope.resolve(TASKS_MODULE);

    const retrievedTask = await taskService.retrieveTask(taskId, {
      relations: ["subtasks", "outgoing", "incoming"],
    });

    if (!retrievedTask) {
      return res.status(404).json({
        error: "Task not found",
      });
    }

    const subtasks = ((retrievedTask as any).subtasks || []).sort((a: any, b: any) => {
      const orderA = (a.metadata as any)?.order || 0;
      const orderB = (b.metadata as any)?.order || 0;
      return orderA - orderB;
    });

    ;(retrievedTask as any).subtasks = subtasks;

    return res.status(200).json({
      task: retrievedTask,
    });
  } catch (error) {
    console.error("Error fetching task:", error);
    return res.status(500).json({
      error: "Failed to fetch task",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
