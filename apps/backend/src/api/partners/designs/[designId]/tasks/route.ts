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
 * Read-only (GET) only. Partner-side task creation (the admin POST) is a
 * separate, decision-bearing slice and is intentionally NOT mirrored yet.
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { assertPartnerOwnsDesign } from "../../helpers"
import { extractDesignTasks, DesignTasksRow } from "./extract-tasks"

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
