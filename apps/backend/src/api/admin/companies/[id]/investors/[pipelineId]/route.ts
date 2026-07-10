import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../../modules/investor"
import type InvestorService from "../../../../../../modules/investor/service"

const STAGES = [
  "lead",
  "contacted",
  "interested",
  "due_diligence",
  "term_sheet",
  "committed",
  "onboarded",
  "closed",
  "passed",
] as const

const STATUSES = ["active", "won", "lost", "on_hold"] as const

// POST /admin/companies/:id/investors/:pipelineId
// Advance / update an investor's pipeline stage (and optionally status) for this
// company. e.g. move a "lead" to "onboarded".
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { pipelineId } = req.params
  const body = (req.body ?? {}) as { stage?: string; status?: string }

  const update: Record<string, string> = { id: pipelineId }

  if (body.stage !== undefined) {
    if (!STAGES.includes(body.stage as any)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid stage "${body.stage}". Allowed: ${STAGES.join(", ")}`
      )
    }
    update.stage = body.stage
  }

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as any)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Invalid status "${body.status}". Allowed: ${STATUSES.join(", ")}`
      )
    }
    update.status = body.status
  }

  if (!update.stage && !update.status) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Provide a stage and/or status to update"
    )
  }

  const investorService: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const [pipeline] = await investorService.updatePipelines([update as any])

  res.json({ pipeline })
}
