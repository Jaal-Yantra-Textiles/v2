import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refetchPartnerForThisAdmin } from "../../helpers"
import listSingleDesignsWorkflow from "../../../../workflows/designs/list-single-design"
import designPartnersLink from "../../../../links/design-partners-link"


export const GET = async (
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) => {
  const { designId } = req.params

  // Partner auth
  const adminId = req.auth_context?.actor_id
  const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope)
  if (!partnerAdmin) {
    return res.status(401).json({ error: "Partner authentication required" })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Verify this design is linked to this partner and fetch tasks via link
  const linkResult = await query.graph({
    entity: designPartnersLink.entryPoint,
    fields: [
      "design.*",
      "design.tasks.*",
      "partner.*",
    ],
    filters: { design_id: designId, partner_id: partnerAdmin.id },
    pagination: { skip: 0, take: 1 },
  })
  const linkData = (linkResult?.data || [])[0]
  if (!linkData || !linkData.design) {
    return res.status(404).json({ error: "Design not found for this partner" })
  }

  // Determine if the design was sent via workflow tasks by checking known titles
  const tasks = (linkData.design?.tasks || []) as Array<{
    title?: string
    status?: string
    updated_at?: string | Date | null
    metadata?: Record<string, unknown> | null
  }>
  const isPartnerWorkflowTask = (t: any) =>
    !!t && [
      "partner-design-start",
      "partner-design-redo",
      "partner-design-finish",
      "partner-design-completed",
    ].includes(t.title)
  const wfTasks = tasks.filter(isPartnerWorkflowTask)
  const hasWorkflowTasks = wfTasks.length > 0

  // Use admin single-design workflow to fetch the full design shape
  const { result: workflowDesign } = await listSingleDesignsWorkflow(req.scope).run({
    input: { id: designId, fields: ["*"] },
  })

  // Helper to find completed tasks by title
  const findCompleted = (title: string) => wfTasks.find((t) => t.title === title && t.status === "completed")

  const startTask = findCompleted("partner-design-start")
  const redoTask = findCompleted("partner-design-redo")
  const finishTask = findCompleted("partner-design-finish")
  const completedTask = findCompleted("partner-design-completed")

  // Prefer metadata from the design node (authoritative), then infer from tasks
  let partner_status: "incoming" | "assigned" | "in_progress" | "finished" | "completed" =
    ((workflowDesign as any)?.metadata?.partner_status as any) || ((linkData.design as any)?.metadata?.partner_status as any) || (hasWorkflowTasks ? "assigned" : "incoming")
  let partner_phase: "redo" | null = ((workflowDesign as any)?.metadata?.partner_phase as any) || ((linkData.design as any)?.metadata?.partner_phase as any) || null
  let partner_started_at: string | null = ((workflowDesign as any)?.metadata?.partner_started_at as any) || ((linkData.design as any)?.metadata?.partner_started_at as any) || null
  let partner_finished_at: string | null = ((workflowDesign as any)?.metadata?.partner_finished_at as any) || ((linkData.design as any)?.metadata?.partner_finished_at as any) || null
  let partner_completed_at: string | null = ((workflowDesign as any)?.metadata?.partner_completed_at as any) || ((linkData.design as any)?.metadata?.partner_completed_at as any) || null

  if ((!partner_status || partner_status === "incoming" || partner_status === "assigned") && hasWorkflowTasks) {
    if (completedTask) {
      partner_status = "completed"
      partner_completed_at = partner_completed_at || (completedTask.updated_at ? String(completedTask.updated_at) : null)
    } else if (finishTask || redoTask) {
      const finishAt = finishTask?.updated_at ? new Date(finishTask.updated_at).getTime() : -1
      const redoAt = redoTask?.updated_at ? new Date(redoTask.updated_at).getTime() : -1
      if (redoAt > finishAt) {
        partner_status = "in_progress"
        partner_phase = "redo"
      } else if (finishTask) {
        partner_status = "finished"
        partner_finished_at = partner_finished_at || (finishTask.updated_at ? String(finishTask.updated_at) : null)
      }
    } else if (startTask) {
      partner_status = "in_progress"
      partner_started_at = partner_started_at || (startTask.updated_at ? String(startTask.updated_at) : null)
    }
  }

  const partner_info = {
    assigned_partner_id: linkData.partner?.id || partnerAdmin.id,
    partner_status,
    partner_phase,
    partner_started_at,
    partner_finished_at,
    partner_completed_at,
    workflow_tasks_count: wfTasks.length,
  }

  // Merge partner_info into the design payload
  const design = {
    ...(workflowDesign || linkData.design),
    partner_info,
  }

  return res.status(200).json({ design })
}
