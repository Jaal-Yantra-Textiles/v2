import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../helpers"
import { DEPLOYMENT_MODULE } from "../../../modules/deployment"
import type DeploymentService from "../../../modules/deployment/service"
import {
  partnerIsOnSharedProject,
  resolveHostingProviderForPartner,
} from "../../../modules/deployment/providers/resolve-partner-provider"
import updatePartnerWorkflow from "../../../workflows/partners/update-partner"
import { getStorefrontRefs } from "./helpers"
import { getPartnerStorefrontStatusWorkflow } from "../../../workflows/partners/get-partner-storefront-status"

const STOREFRONT_META_KEYS = [
  "vercel_project_id",
  "vercel_project_name",
  "storefront_domain",
  "storefront_provisioned_at",
]

/**
 * Build the metadata patch that removes the storefront keys.
 *
 * Metadata updates MERGE — Medusa's internal service runs the incoming object
 * through `mergeMetadata`, so a key simply left out of the patch keeps its old
 * value. This used to return "everything except the storefront keys" and the
 * storefront refs therefore survived every removal: a partner kept a stale
 * `vercel_project_id` forever, and "cleared" in the response was a lie.
 *
 * The empty string is mergeMetadata's delete sentinel, so each storefront key
 * is tombstoned explicitly. Returning null (the old empty case) is worse than
 * useless: an absent metadata patch means "no change at all".
 */
function stripStorefrontKeys(metadata: any): Record<string, any> {
  const current = (metadata || {}) as Record<string, any>
  const patch: Record<string, any> = {}
  for (const key of STOREFRONT_META_KEYS) {
    if (key in current) {
      patch[key] = ""
    }
  }
  return patch
}

/**
 * GET /partners/storefront
 *
 * Hosting status for the partner's storefront. The resolution itself lives in
 * `getPartnerStorefrontStatusWorkflow` so the admin inspection mirror
 * (`GET /admin/partners/:id/storefront`) reports the identical state (#843).
 *
 * The one thing that stays here is the WRITE: when the provider no longer knows
 * the project, the refs we hold are stale and the partner's record is cleaned
 * up. The mirror deliberately reports `stale_project` without performing it.
 */
export const GET = async (
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

  const { result: status } = await getPartnerStorefrontStatusWorkflow(
    req.scope
  ).run({ input: { partner } })

  if (status.stale_project) {
    try {
      await updatePartnerWorkflow(req.scope).run({
        input: {
          id: partner.id,
          data: {
            metadata: stripStorefrontKeys(partner.metadata),
            hosting_provider: null,
            deployment_account_id: null,
            deployment_project_id: null,
            deployment_project_name: null,
            vercel_project_id: null,
            vercel_project_name: null,
            vercel_last_deployment_id: null,
            vercel_linked: false,
            storefront_domain: null,
          },
        },
      })
    } catch {
      // best-effort cleanup
    }
  }

  // `stale_project` is an instruction to this route, not part of the partner
  // contract — strip it so the response shape is unchanged.
  const { stale_project: _staleProject, ...body } = status

  res.json(body)
}

/**
 * DELETE /partners/storefront
 * Remove the Vercel project, Cloudflare DNS, and clear storefront metadata.
 */
export const DELETE = async (
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

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const refs = getStorefrontRefs(partner)
  const projectRef = refs.projectRef
  const storefrontDomain = refs.storefrontDomain

  if (!projectRef) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Storefront has not been provisioned"
    )
  }

  const results: Record<string, any> = {}

  // A SHARED, multi-tenant project (e.g. the Cloudflare shared worker) is owned
  // by us and serves EVERY tenant — removing one partner must only detach that
  // partner's domain, NEVER tear down the shared project. Deleting it here is
  // what wiped the shared worker for all tenants; guard it.
  const isShared = await partnerIsOnSharedProject(partner, req.scope)

  // Remove the project on whatever provider the partner is on.
  try {
    const { provider } = await resolveHostingProviderForPartner(partner, req.scope)
    if (storefrontDomain) {
      try {
        await provider.removeDomain(projectRef, storefrontDomain)
        results.domain = { action: "removed" }
      } catch (e: any) {
        results.domain = { action: "failed", error: e.message }
      }
    }
    if (isShared) {
      // Shared project: detached the domain above; leave the project standing.
      results.project = {
        action: "skipped",
        reason: "shared multi-tenant project — only the partner's domain is detached",
      }
    } else if (typeof provider.deleteProject === "function") {
      // deleteProject is an optional HostingProvider method (#345); every current
      // adapter (Vercel/Cloudflare Pages/Netlify/Render) implements it, so this
      // path fully tears down the project via the resolved account's creds. The
      // legacy branch stays as a fallback for env-only Vercel setups.
      await provider.deleteProject(projectRef)
      results.project = { action: "deleted" }
    } else if (refs.providerName === "vercel" && deployment.isVercelConfigured()) {
      await deployment.deleteProject(projectRef)
      results.project = { action: "deleted" }
    } else {
      results.project = {
        action: "skipped",
        reason: `Provider "${refs.providerName}" has no API delete — remove it in the provider dashboard`,
      }
    }
  } catch (e: any) {
    results.project = { action: "failed", error: e.message }
  }

  // Remove the Cloudflare DNS record (our zone) for the subdomain.
  if (storefrontDomain) {
    results.dns = await deployment.removeStorefrontDns(storefrontDomain)
  } else {
    results.dns = { action: "skipped", reason: "No domain" }
  }

  // Decrement the account's project_count (best-effort) so freed capacity is
  // reflected in future rotation.
  const accountId = partner?.deployment_account_id
  if (accountId && !isShared) {
    try {
      const acct = await deployment.retrieveDeploymentAccount(accountId)
      const next = Math.max(0, ((acct as any)?.project_count ?? 1) - 1)
      await deployment.updateDeploymentAccounts({ id: accountId, project_count: next })
      results.account = { action: "decremented" }
    } catch (e: any) {
      results.account = { action: "failed", error: e.message }
    }
  }

  // Clear storefront state via the update workflow (proper DB write).
  await updatePartnerWorkflow(req.scope).run({
    input: {
      id: partner.id,
      data: {
        metadata: stripStorefrontKeys(partner.metadata),
        hosting_provider: null,
        deployment_account_id: null,
        deployment_project_id: null,
        deployment_project_name: null,
        vercel_project_id: null,
        vercel_project_name: null,
        vercel_last_deployment_id: null,
        vercel_linked: false,
        storefront_domain: null,
      },
    },
  })

  results.metadata = { action: "cleared" }

  res.json({
    message: "Storefront removed",
    results,
  })
}
