import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { DEPLOYMENT_MODULE } from "../../../../../modules/deployment"
import type DeploymentService from "../../../../../modules/deployment/service"
import updatePartnerWorkflow from "../../../../../workflows/partners/update-partner"

/**
 * POST /partners/storefront/domain/verify
 * Trigger domain ownership verification on Vercel.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const vercelProjectId = partner.metadata?.vercel_project_id
  const customDomain = partner.metadata?.custom_domain as string | undefined

  if (!vercelProjectId || !customDomain) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "No custom domain configured"
    )
  }

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const result = await deployment.verifyDomain(vercelProjectId, customDomain)

  if (result.verified) {
    await updatePartnerWorkflow(req.scope).run({
      input: {
        id: partner.id,
        data: {
          metadata: {
            ...(partner.metadata || {}),
            custom_domain_verified: true,
          },
        },
      },
    })
  }

  let config: any = null
  try {
    config = await deployment.getDomainConfig(customDomain)
  } catch {
    // non-critical
  }

  res.json({
    domain: customDomain,
    verified: result.verified,
    verification: result.verification || null,
    misconfigured: config?.misconfigured ?? true,
    configured_by: config?.configuredBy ?? null,
  })
}
