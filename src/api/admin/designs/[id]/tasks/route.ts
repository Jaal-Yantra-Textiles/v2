
/**
 * Route: /admin/designs/:id/tasks
 *
 * GET
 * Retrieves tasks associated with a design.
 *
 * @remarks
 * - Validates that the design with the given id exists.
 * - Runs an internal workflow to fetch tasks for the design.
 * - Returns a 200 response with the tasks list, or a 404 if the design is not found.
 *
 * @param req - MedusaRequest with params.id (design id) and request scope for authorization.
 * @param res - MedusaResponse that receives a JSON body:
 *   { tasks: Task[] }
 *
 * @returns A 200 response containing the tasks for the design:
 *   {
 *     tasks: Array<Task>
 *   }
 *
 * @throws {MedusaError} NOT_FOUND if the design with the given id does not exist.
 *
 * @example
 * curl -X GET "https://api.example.com/admin/designs/dc_123/tasks" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json"
 *
 * Response (200):
 * {
 *   "tasks": [
 *     {
 *       "id": "task_1",
 *       "title": "Initial review",
 *       "status": "pending",
 *       // ...other task fields
 *     }
 *   ]
 * }
 *
 * ---------------------------------------------------------------------
 *
 * POST
 * Creates one or more tasks for a design using templates or parent-child logic.
 *
 * @remarks
 * - Validates that the design exists.
 * - Accepts a validated body of type AdminPostDesignTasksReqType (see validators).
 * - Triggers a workflow to create tasks from templates or via parent-child relationships.
 * - Refetches and returns full task objects for the created tasks.
 *
 * @param req - MedusaRequest<AdminPostDesignTasksReqType> with:
 *   - params.id (design id)
 *   - validatedBody (payload matching AdminPostDesignTasksReqType)
 *   - request scope for authorization
 * @param res - MedusaResponse that receives a JSON body:
 *   {
 *     taskLinks: {
 *       list: Task[];    // full task objects (always returned as an array)
 *       count: number;   // number of created/linked tasks
 *     };
 *     message: string;
 *   }
 *
 * @returns A 200 response including created task details and a message.
 *
 * @throws {MedusaError} NOT_FOUND if the design with the given id does not exist.
 * @throws ValidationError for invalid request body (handled by validators).
 *
 * @example
 * curl -X POST "https://api.example.com/admin/designs/dc_123/tasks" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "templateIds": ["tpl_abc", "tpl_def"],
 *     "withTemplates": true,
 *     "assigneeId": "user_123"
 *   }'
 *
 * Response (200):
 * {
 *   "taskLinks": {
 *     "list": [
 *       {
 *         "id": "task_1",
 *         "title": "Design asset from template tpl_abc",
 *         "status": "open",
 *         // ...other task fields
 *       },
 *       {
 *         "id": "task_2",
 *         "title": "Design asset from template tpl_def",
 *         "status": "open",
 *         // ...other task fields
 *       }
 *     ],
 *     "count": 2
 *   },
 *   "message": "Design dc_123 successfully created 2 tasks from templates"
 * }
 */
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