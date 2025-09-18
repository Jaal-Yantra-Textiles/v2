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

  // Include all linked designs for this partner.
  // We'll compute assignment status based on presence of partner workflow tasks (by known titles).
  const allLinked = (results || [])

  // post-filter by design.status if requested
  let filtered = allLinked
  if (status) {
    filtered = allLinked.filter((linkData: any) => linkData.design?.status === status)
  }

  const designs = filtered.map((linkData: any) => {
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

    // Derive from metadata first (authoritative), then fall back to task-based inference
    let partnerStatus: "incoming" | "assigned" | "in_progress" | "finished" | "completed" =
      (design?.metadata?.partner_status as any) || "incoming"
    let partnerPhase: "redo" | null = (design?.metadata?.partner_phase as any) || null
    let partnerStartedAt: string | null = (design?.metadata?.partner_started_at as any) || null
    let partnerFinishedAt: string | null = (design?.metadata?.partner_finished_at as any) || null
    let partnerCompletedAt: string | null = (design?.metadata?.partner_completed_at as any) || null

    if (workflowTasks.length > 0) {
      // start -> redo (optional) -> finish -> completed
      const startTask = workflowTasks.find((t: any) => t.title === "partner-design-start" && t.status === "completed")
      const redoTask = workflowTasks.find((t: any) => t.title === "partner-design-redo" && t.status === "completed")
      const finishTask = workflowTasks.find((t: any) => t.title === "partner-design-finish" && t.status === "completed")
      const completedTask = workflowTasks.find((t: any) => t.title === "partner-design-completed" && t.status === "completed")

      // If metadata didn't set a terminal state, infer from tasks
      if (!partnerStatus || partnerStatus === "incoming" || partnerStatus === "assigned") {
        partnerStatus = "assigned"
        if (completedTask) {
          partnerStatus = "completed"
          partnerCompletedAt = partnerCompletedAt || (completedTask.updated_at ? String(completedTask.updated_at) : null)
        } else if (finishTask || redoTask) {
          const finishAt = finishTask?.updated_at ? new Date(finishTask.updated_at).getTime() : -1
          const redoAt = redoTask?.updated_at ? new Date(redoTask.updated_at).getTime() : -1
          if (redoAt > finishAt) {
            partnerStatus = "in_progress"
            partnerPhase = "redo"
          } else if (finishTask) {
            partnerStatus = "finished"
            partnerFinishedAt = partnerFinishedAt || (finishTask.updated_at ? String(finishTask.updated_at) : null)
          }
        } else if (startTask) {
          partnerStatus = "in_progress"
          partnerStartedAt = partnerStartedAt || (startTask.updated_at ? String(startTask.updated_at) : null)
        }
      }
    }

    const partner_info = {
      assigned_partner_id: linkData.partner?.id || partnerAdmin.id,
      partner_status: partnerStatus,
      partner_phase: partnerPhase,
      partner_started_at: partnerStartedAt,
      partner_finished_at: partnerFinishedAt,
      partner_completed_at: partnerCompletedAt,
      workflow_tasks_count: workflowTasks.length,
    }

    return {
      ...design,
      partner_info,
    }
  })

  res.status(200).json({
    designs,
    count: designs.length,
    limit,
    offset,
  })
}
