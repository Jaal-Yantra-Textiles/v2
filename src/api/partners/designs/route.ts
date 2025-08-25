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
  console.log(results)
  // Include all linked designs for this partner.
  // We'll compute assignment status based on presence of partner workflow tasks (by known titles).
  const allLinked = (results || [])

  // post-filter by design.status if requested
  let filtered = allLinked
  if (status) {
    filtered = allLinked.filter((linkData: any) => linkData.design?.status === status)
  }

  const items = filtered.map((linkData: any) => {
    const design = linkData.design

    const tasks = design.tasks || []
    const isPartnerWorkflowTask = (t: any) =>
      !!t && [
        "partner-design-start",
        "partner-design-redo",
        "partner-design-finish",
        "partner-design-completed",
      ].includes(t.title)
    const workflowTasks = tasks.filter(isPartnerWorkflowTask)

    // Determine partner assignment + status from task completion stages
    // If no workflow tasks exist -> incoming (linked but not sent/assigned)
    // If tasks exist -> consider assigned and derive phase progression
    let partnerStatus: "incoming" | "assigned" | "in_progress" | "finished" | "completed" = "incoming"
    let partnerPhase: string | null = null
    let partnerStartedAt: string | null = null
    let partnerFinishedAt: string | null = null
    let partnerCompletedAt: string | null = null

    if (workflowTasks.length > 0) {
      // start -> redo (optional) -> finish -> completed
      const startTask = workflowTasks.find((t: any) => t.title === "partner-design-start" && t.status === "completed")
      const redoTask = workflowTasks.find((t: any) => t.title === "partner-design-redo" && t.status === "completed")
      const finishTask = workflowTasks.find((t: any) => t.title === "partner-design-finish" && t.status === "completed")
      const completedTask = workflowTasks.find((t: any) => t.title === "partner-design-completed" && t.status === "completed")

      partnerStatus = "assigned"

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
    }

    return {
      design_id: design.id,
      partner_id: linkData.partner?.id || partnerAdmin.id,
      design,
      partner: linkData.partner,
      assignment: {
        status: partnerStatus,
        phase: partnerPhase,
        started_at: partnerStartedAt,
        finished_at: partnerFinishedAt,
        completed_at: partnerCompletedAt,
        workflow_tasks_count: workflowTasks.length,
      },
    }
  })

  res.status(200).json({
    designs: items,
    count: items.length,
    limit,
    offset,
  })
}
