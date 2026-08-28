/**
 * @route /admin/production-runs/:id/consumption-logs/commit
 * @scope admin
 *
 * Commit this run's consumption logs.
 *
 * 🔴 Not a convenience wrapper. `is_committed` is what `apply-to-inventory`
 * requires before it will deduct stock, and committing was design-scoped — so
 * a log on a product-only run could be written and then never committed and
 * never applied. Recorded, but inert. This is the other half of the run-scoped
 * capture route: a source of consumption with no commit path is a dead end.
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { commitConsumptionWorkflow } from "../../../../../../workflows/consumption-logs/commit-consumption"
import { AdminPostRunCommitConsumptionReq } from "../validators"

export const POST = async (
  req: MedusaRequest<AdminPostRunCommitConsumptionReq>,
  res: MedusaResponse
) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const runId = req.params.id

  const { result, errors } = await commitConsumptionWorkflow(req.scope).run({
    input: {
      production_run_id: runId,
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
