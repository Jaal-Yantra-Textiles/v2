import { MedusaError, Modules } from "@medusajs/utils"
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework"
import { createTasksFromTemplatesWorkflow } from "../../../../../workflows/designs/create-tasks-from-templates"
import { getDesignTasksWorkflow } from "../../../../../workflows/designs/get-design-tasks"
import { AdminPostDesignTasksReqType } from "./validators"
import { refetchTask } from "./helpers"


export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  // Validate design exists
  const designExists = await refetchEntity({
    entity: "design",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design with id ${id} was not found`
    )
  }

  const { result: tasks } = await getDesignTasksWorkflow(req.scope).run({
    input: {
      designId: id
    }
  })


  return res.status(200).json({
    tasks: tasks[0].tasks
  })
}

export const POST = async (req: MedusaRequest<AdminPostDesignTasksReqType>, res: MedusaResponse) => {
  const { id } = req.params
  
  // Validate design exists
  const designExists = await refetchEntity({
    entity: "design",
    idOrFilter: id,
    scope: req.scope,
    fields: ["id"]
  })

  if (!designExists) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Design not found for the id ${id}`
    )
  }
  // Run workflow with validated body
  const {result: list} = await createTasksFromTemplatesWorkflow(req.scope).run({
    input: {
      ...req.validatedBody,
      designId: id,
    },
  });

  // Get workflow response data
  const workflowResponse = list[0];

  const taskLinks = list[1];

  // Determine which tasks to fetch based on workflow response
  let taskIds: string[] = [];
  
  if (workflowResponse.withTemplates) {
    // For template-based tasks, get all task IDs
    taskIds = taskLinks.map(task => task.id);
  } else if (workflowResponse.withParent) {
    // For parent-child tasks, get parent task ID
    taskIds = taskLinks.map(task => task.id);
  } else if (workflowResponse.withoutTemplates) {
    // For single task without templates
    taskIds = [taskLinks[0].id];
  }

  // Fetch full task details
  const tasks = await refetchTask(taskIds, req.scope, [
    "*"
  ]);

  return res.status(200).json({
    taskLinks: {
      list: Array.isArray(tasks) ? tasks : [tasks],
      count: taskLinks.length,
    },
    message: `Design ${id} successfully created ${taskLinks.length} tasks from templates`,
  });
}