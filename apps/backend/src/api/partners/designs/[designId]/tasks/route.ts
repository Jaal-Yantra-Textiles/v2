/**
 * @file Partner API route for a design's tasks.
 * @module API/Partners/Designs/Tasks
 *
 * Roadmap #6 — promote admin Designs to partner-ui. Mirrors
 * `GET /admin/designs/:id/tasks` (same `tasks.*` read + `{ tasks }`
 * response shape), but guarded to the owning partner. Tasks are direct
 * children of the design, so the design-ownership guard is the security
 * boundary — there is no cross-design relation to leak through here.
 *
 * GET mirrors `GET /admin/designs/:id/tasks`; POST mirrors
 * `POST /admin/designs/:id/tasks` (same `createTasksFromTemplatesWorkflow`
 * call + `{ taskLinks: { list, count }, message }` response). Both are guarded
 * to the owning partner.
 *
 * Why the POST is safe to self-serve (unlike approve/notify-customer/
 * partner/cancel-assignment): it only attaches tasks — optionally from shared
 * admin task-templates — to the partner's OWN design. There is no assignee/
 * partner field in the body, no storefront product created, no customer email,
 * and no partner-assignment change, so design ownership is the full boundary.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createTasksFromTemplatesWorkflow } from "../../../../../workflows/designs/create-tasks-from-templates"
import { refetchTask } from "../../../../admin/designs/[id]/tasks/helpers"
import { assertPartnerOwnsDesign } from "../../helpers"
import { extractDesignTasks, DesignTasksRow } from "./extract-tasks"
import { PartnerPostDesignTasksReqType } from "./validators"
import { selectCreatedTaskIds } from "./select-task-ids"

/**
 * List the tasks of a partner-owned design.
 * @route GET /partners/designs/{designId}/tasks
 *
 * @returns {Object} 200 - { tasks }
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Design is not owned by this partner
 * @throws {MedusaError} 404 - Design not found
 */
export async function GET(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) {
  const { designId } = req.params

  // Ownership guard (401/403/404). Self-serve designs only — an
  // admin-assigned design is not a partner's to inspect tasks of.
  await assertPartnerOwnsDesign(req, designId)

  const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: "design",
    fields: ["tasks.*"],
    filters: { id: designId },
  })

  // Safe extraction — admin reads tasks[0].tasks directly (throws on empty).
  const tasks = extractDesignTasks(data as DesignTasksRow[])

  res.status(200).json({ tasks })
}

/**
 * Create one or more tasks for a partner-owned design (optionally from shared
 * admin task-templates). Mirrors `POST /admin/designs/:id/tasks`.
 * @route POST /partners/designs/{designId}/tasks
 *
 * @returns {Object} 200 - { taskLinks: { list, count }, message }
 * @throws {MedusaError} 401 - Partner authentication required
 * @throws {MedusaError} 403 - Design is not owned by this partner
 * @throws {MedusaError} 404 - Design not found
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PartnerPostDesignTasksReqType> & {
    params: { designId: string }
  },
  res: MedusaResponse
) {
  const { designId } = req.params

  // Ownership guard (401/403/404). Only the owning partner may add tasks to
  // their own design — an admin-assigned design is not theirs to mutate.
  await assertPartnerOwnsDesign(req, designId)

  const { result: list } = await createTasksFromTemplatesWorkflow(
    req.scope
  ).run({
    input: {
      ...(req.validatedBody as any),
      designId,
    },
  })

  const workflowResponse = list[0] as any
  const taskLinks = (list[1] as any[]) || []

  const taskIds = selectCreatedTaskIds(workflowResponse, taskLinks)

  const tasks = taskIds.length
    ? await refetchTask(taskIds, req.scope, ["*"])
    : []

  res.status(200).json({
    taskLinks: {
      list: Array.isArray(tasks) ? tasks : [tasks],
      count: taskLinks.length,
    },
    message: `Design ${designId} successfully created ${taskLinks.length} tasks from templates`,
  })
}
