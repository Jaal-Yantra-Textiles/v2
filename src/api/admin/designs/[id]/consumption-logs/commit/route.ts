import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { AdminPostCommitConsumptionReq } from "../validators"
import { commitConsumptionWorkflow } from "../../../../../../workflows/consumption-logs/commit-consumption"

export const POST = async (
  req: MedusaRequest<AdminPostCommitConsumptionReq>,
  res: MedusaResponse
) => {
  const designId = req.params.id

  const { result, errors } = await commitConsumptionWorkflow(req.scope).run({
    input: {
      design_id: designId,
      log_ids: req.validatedBody.logIds,
      commit_all: req.validatedBody.commitAll,
      default_location_id: req.validatedBody.defaultLocationId,
    },
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors)
    throw errors
  }

  res.status(200).json(result)
}
