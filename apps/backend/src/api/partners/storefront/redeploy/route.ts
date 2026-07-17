import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { partnerIsOnSharedProject } from "../../../../modules/deployment/providers/resolve-partner-provider"
import { redeployStorefrontWorkflow } from "../../../../workflows/stores/redeploy-storefront"

const STOREFRONT_REPO_ENV = process.env.VERCEL_STOREFRONT_REPO || ""
const STOREFRONT_BRANCH_ENV = process.env.VERCEL_STOREFRONT_BRANCH || "main"

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

  // Shared multi-tenant deployment: it's owned + deployed by us and serves every
  // tenant, resolving the store per-request from the Host header. A per-partner
  // redeploy would (with update_env) pin THIS partner's publishable key onto the
  // shared project for all tenants, then redeploy it platform-wide. No-op it.
  if (await partnerIsOnSharedProject(partner, req.scope)) {
    return res.json({
      message:
        "Your storefront runs on a shared, centrally-managed deployment — content updates are live automatically, so no redeploy is needed.",
      deployment: { id: "shared", url: "", status: "shared" },
    })
  }

  const vercelProjectId =
    (partner as any).vercel_project_id || partner.metadata?.vercel_project_id
  const vercelProjectName =
    (partner as any).vercel_project_name || partner.metadata?.vercel_project_name
  const storefrontRepo =
    (partner as any).storefront_repo || STOREFRONT_REPO_ENV
  const storefrontBranch =
    (partner as any).storefront_branch || STOREFRONT_BRANCH_ENV

  if (!vercelProjectId || !vercelProjectName) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned yet."
    )
  }

  if (!storefrontRepo) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "No storefront repo configured (partner.storefront_repo or VERCEL_STOREFRONT_REPO)"
    )
  }

  const body = (req.body || {}) as { update_env?: boolean; ref?: string }

  // Mutations (optional env sync → Vercel deploy → record deployment id)
  // live in redeployStorefrontWorkflow with compensation.
  const { result: deployment } = await redeployStorefrontWorkflow(req.scope).run({
    input: {
      partner_id: partner.id,
      vercel_project_id: vercelProjectId,
      vercel_project_name: vercelProjectName,
      storefront_repo: storefrontRepo,
      ref: body.ref || storefrontBranch,
      update_env: !!body.update_env,
    },
  })

  res.json({
    message: "Redeployment triggered",
    deployment: {
      id: deployment.id,
      url: deployment.url,
      status: deployment.status,
    },
  })
}
