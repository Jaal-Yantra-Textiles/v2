import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../../../modules/deployment"
import type DeploymentService from "../../../modules/deployment/service"
import { buildApiConfig, redactDeploymentAccount } from "./helpers"
import type { CreateDeploymentAccountBody } from "./validators"

/**
 * GET /admin/deployment-accounts — list rotatable hosting accounts (redacted).
 * Filters: q (label), provider, status. Ordered by provider, then priority desc.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const query = (req.validatedQuery || req.query) as Record<string, any>

  const filters: Record<string, any> = {}
  if (query.provider) filters.provider = query.provider
  if (query.status) filters.status = query.status

  const [accounts, count] = await deployment.listAndCountDeploymentAccounts(filters, {
    take: query.limit ? Number(query.limit) : 100,
    skip: query.offset ? Number(query.offset) : 0,
    order: { provider: "ASC", priority: "DESC" },
  })

  const q = (query.q as string | undefined)?.toLowerCase()
  const filtered = q
    ? accounts.filter((a: any) => (a.label || "").toLowerCase().includes(q))
    : accounts

  res.json({
    deployment_accounts: filtered.map(redactDeploymentAccount),
    count,
    offset: query.offset ? Number(query.offset) : 0,
    limit: query.limit ? Number(query.limit) : 100,
  })
}

/**
 * POST /admin/deployment-accounts — register a new hosting account. The token
 * is encrypted at rest; other provider ids are stored in api_config.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const body = (req.validatedBody || req.body) as CreateDeploymentAccountBody
  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)

  const api_config = buildApiConfig(body, req.scope)

  const created = await deployment.createDeploymentAccounts({
    provider: body.provider,
    role: body.role || "hosting",
    label: body.label,
    api_config,
    cutoff_max: body.cutoff_max ?? null,
    priority: body.priority ?? 0,
    status: body.status ?? "active",
  })

  const account = Array.isArray(created) ? created[0] : created
  if (!account) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, "Failed to create deployment account")
  }

  res.status(201).json({ deployment_account: redactDeploymentAccount(account) })
}
