import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../../../../modules/deployment"
import type DeploymentService from "../../../../modules/deployment/service"
import { buildApiConfig, redactDeploymentAccount } from "../helpers"
import type { UpdateDeploymentAccountBody } from "../validators"

async function retrieveOr404(
  deployment: DeploymentService,
  id: string
): Promise<any> {
  try {
    return await deployment.retrieveDeploymentAccount(id)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Deployment account ${id} not found`)
  }
}

/** GET /admin/deployment-accounts/:id — retrieve (redacted). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const account = await retrieveOr404(deployment, req.params.id)
  res.json({ deployment_account: redactDeploymentAccount(account) })
}

/**
 * POST/PUT /admin/deployment-accounts/:id — update. Token is only re-encrypted
 * when a non-empty `token` is supplied; other api_config fields merge onto the
 * existing config. `status: "full"` is the manual cutoff; raising `cutoff_max`
 * is the "round-up" on upgrade.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody || req.body) as UpdateDeploymentAccountBody
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const existing = await retrieveOr404(deployment, req.params.id)

  const api_config = buildApiConfig(body, req.scope, existing.api_config)

  const update: Record<string, any> = { id: req.params.id, api_config }
  if (body.label !== undefined) update.label = body.label
  if (body.role !== undefined) update.role = body.role
  if (body.cutoff_max !== undefined) update.cutoff_max = body.cutoff_max
  if (body.priority !== undefined) update.priority = body.priority
  if (body.status !== undefined) update.status = body.status

  await deployment.updateDeploymentAccounts(update)
  const updated = await deployment.retrieveDeploymentAccount(req.params.id)
  res.json({ deployment_account: redactDeploymentAccount(updated) })
}

export const PUT = POST

/** DELETE /admin/deployment-accounts/:id. */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  await retrieveOr404(deployment, req.params.id)
  await deployment.deleteDeploymentAccounts(req.params.id)
  res.json({ id: req.params.id, object: "deployment_account", deleted: true })
}
