import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { AdminPostCommitConsumptionReq } from "../validators"
import { commitConsumptionWorkflow } from "../../../../../../workflows/consumption-logs/commit-consumption"

export const POST = async (
  req: MedusaRequest<AdminPostCommitConsumptionReq>,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const designId = req.params.id

  const { result, errors } = await commitConsumptionWorkflow(req.scope).run({
    input: {
      design_id: designId,
      log_ids: req.validatedBody.logIds,
      commit_all: req.validatedBody.commitAll,
    },
  })

  if (errors.length > 0) {
    logger.warn(`Error reported at ${JSON.stringify(errors)}`)
    throw errors
  }

  res.status(200).json(result)
}
