import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { finishPartnerTaskWorkflow } from "../../../../../workflows/tasks/finish-partner-task"
import { getPartnerFromAuthContext } from "../../../helpers"

/**
 * POST /partners/assigned-tasks/[taskId]/finish
 * Partner completes a standalone task (optionally submitting cost data).
 * Thin route — orchestration lives in `finishPartnerTaskWorkflow`.
 */
export async function POST(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) {
  const taskId = req.params.taskId
  if (!req.auth_context?.actor_id) {
    return res.status(401).json({ message: "Partner authentication required" })
  }

  try {
    const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "No partner associated with this admin"
      )
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data: taskData } = await query.index({
      entity: "task",
      fields: ["*", "partners.*"],
      filters: { partners: { id: partner.id }, id: taskId },
    })

    if (!taskData?.length) {
      return res.status(403).json({
        message: "Task not assigned to this partner or does not exist",
      })
    }

    const body = req.body as {
      actual_cost?: number
      cost_type?: "per_unit" | "total"
      cost_currency?: string
    } | undefined

    const { result, errors } = await finishPartnerTaskWorkflow(req.scope).run({
      input: {
        task_id: taskId,
        cost: {
          actual_cost: body?.actual_cost,
          cost_type: body?.cost_type,
          cost_currency: body?.cost_currency,
        },
      },
    })

    if (errors?.length) {
      console.warn("Error completing task:", errors)
      throw errors
    }

    res.status(200).json({
      task: result.tasks[0],
      message: "Task completed successfully",
    })
  } catch (error) {
    console.error("Error completing task:", error)
    res.status(500).json({
      message: "Failed to complete task",
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
