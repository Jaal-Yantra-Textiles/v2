import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../helpers"
import { ListDesignsQuery } from "./validators"
import designPartnersLink from "../../../links/design-partners-link"

export async function GET(
  req: AuthenticatedMedusaRequest<ListDesignsQuery>,
  res: MedusaResponse
) {
  const { limit = 20, offset = 0, status } = req.validatedQuery

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Authenticated partner
  const adminId = req.auth_context.actor_id
  const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partnerAdmin) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  // Filters: cannot filter on linked design properties; filter post-query if needed
  const filters: any = { partner_id: partnerAdmin.id }

  const { data: results } = await query.graph({
    entity: designPartnersLink.entryPoint,
    fields: [
      "design.*",
      "design.tasks.*",
      "partner.*",
    ],
    filters,
    pagination: { skip: offset, take: limit },
  })

  // post-filter by design.status if requested
  let filtered = results
  if (status) {
    filtered = results.filter((linkData: any) => linkData.design?.status === status)
  }

  const designs = filtered.map((linkData: any) => {
    const design = linkData.design

    const tasks = design.tasks || []
    const workflowTasks = tasks.filter(
      (t: any) => t && t.metadata?.workflow_type === "partner_design_assignment"
    )

    // Determine partner status from task completion stages
    // start -> redo (optional) -> finish -> completed
    const startTask = workflowTasks.find((t: any) => t.title === "partner-design-start" && t.status === "completed")
    const redoTask = workflowTasks.find((t: any) => t.title === "partner-design-redo" && t.status === "completed")
    const finishTask = workflowTasks.find((t: any) => t.title === "partner-design-finish" && t.status === "completed")
    const completedTask = workflowTasks.find((t: any) => t.title === "partner-design-completed" && t.status === "completed")

    let partnerStatus = "assigned"
    let partnerPhase: string | null = null
    let partnerStartedAt: string | null = null
    let partnerFinishedAt: string | null = null
    let partnerCompletedAt: string | null = null

    if (completedTask) {
      partnerStatus = "completed"
      partnerCompletedAt = completedTask.updated_at ? String(completedTask.updated_at) : null
    } else if (finishTask || redoTask) {
      const finishAt = finishTask?.updated_at ? new Date(finishTask.updated_at).getTime() : -1
      const redoAt = redoTask?.updated_at ? new Date(redoTask.updated_at).getTime() : -1
      if (redoAt > finishAt) {
        // Redo requested after finish -> still in progress, but in redo phase
        partnerStatus = "in_progress"
        partnerPhase = "redo"
      } else if (finishTask) {
        partnerStatus = "finished"
        partnerFinishedAt = finishTask.updated_at ? String(finishTask.updated_at) : null
      }
    } else if (startTask) {
      partnerStatus = "in_progress"
      partnerStartedAt = startTask.updated_at ? String(startTask.updated_at) : null
    }

    return {
      id: design.id,
      name: design.name,
      status: design.status,
      priority: design.priority,
      target_completion_date: design.target_completion_date,
      partner_info: {
        assigned_partner_id: linkData.partner?.id || partnerAdmin.id,
        partner_status: partnerStatus,
        partner_phase: partnerPhase,
        partner_started_at: partnerStartedAt,
        partner_finished_at: partnerFinishedAt,
        partner_completed_at: partnerCompletedAt,
        workflow_tasks_count: workflowTasks.length,
      },
      created_at: design.created_at,
      updated_at: design.updated_at,
    }
  })

  res.status(200).json({
    designs,
    count: filtered.length,
    limit,
    offset,
  })
}
