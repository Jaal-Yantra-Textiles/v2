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

const STOREFRONT_META_KEYS = [
  "vercel_project_id",
  "vercel_project_name",
  "storefront_domain",
  "storefront_provisioned_at",
]

function stripStorefrontKeys(metadata: any): Record<string, any> | null {
  const current = (metadata || {}) as Record<string, any>
  const clean: Record<string, any> = {}
  for (const [key, value] of Object.entries(current)) {
    if (!STOREFRONT_META_KEYS.includes(key)) {
      clean[key] = value
    }
  }
  return Object.keys(clean).length > 0 ? clean : null
}

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

  const deployment: DeploymentService = req.scope.resolve(DEPLOYMENT_MODULE)
  const refs = getStorefrontRefs(partner)

  if (!refs.projectRef) {
    return res.json({
      provisioned: false,
      provider: refs.providerName,
      message: "Storefront has not been provisioned yet",
      vercel_configured: deployment.isVercelConfigured(),
      cloudflare_configured: deployment.isCloudflareConfigured(),
    })
  }

  // Resolve the partner's provider (Vercel/Cloudflare Pages/Netlify/Render) and
  // confirm the project still exists. Vercel keeps its richer latest-deployment
  // detail; other providers report existence + the stored deployment id.
  let provider: Awaited<ReturnType<typeof resolveHostingProviderForPartner>>
  try {
    provider = await resolveHostingProviderForPartner(partner, req.scope)
  } catch (e: any) {
    return res.json({
      provisioned: true,
      provider: refs.providerName,
      project: { id: refs.projectRef, name: refs.vercelProjectName },
      domain: refs.storefrontDomain,
      storefront_url: refs.storefrontDomain ? `https://${refs.storefrontDomain}` : null,
      provisioned_at: refs.storefrontProvisionedAt,
      latest_deployment: null,
      error: `Hosting provider not resolvable: ${e.message}`,
    })
  }

  try {
    const project = await provider.provider.getProject(refs.projectRef)

    let deploymentInfo: {
      id: string
      url: string
      status: string
      created_at: number
    } | null = null

    // Vercel exposes latest-deployment detail via the legacy service client.
    if (refs.providerName === "vercel") {
      try {
        const vProject = await deployment.getProject(refs.projectRef)
        const latest = vProject.latestDeployments?.[0]
        if (latest) {
          try {
            const details = await deployment.getDeployment(latest.id)
            deploymentInfo = {
              id: details.id,
              url: details.url,
              status: details.readyState,
              created_at: details.createdAt,
            }
          } catch {
            deploymentInfo = {
              id: latest.id,
              url: latest.url,
              status: latest.readyState,
              created_at: latest.createdAt,
            }
          }
        }
      } catch {
        // non-fatal — status still returns
      }
    }

    res.json({
      provisioned: true,
      provider: refs.providerName,
      project: { id: project.id, name: project.name },
      domain: refs.storefrontDomain,
      storefront_url: refs.storefrontDomain
        ? `https://${refs.storefrontDomain}`
        : null,
      provisioned_at: refs.storefrontProvisionedAt,
      latest_deployment: deploymentInfo,
      vercel_configured: deployment.isVercelConfigured(),
      cloudflare_configured: deployment.isCloudflareConfigured(),
    })
  } catch (e: any) {
    // Project no longer exists on the provider (404) — treat as unprovisioned
    // and clear stale references.
    const is404 = e.message?.includes("(404)") || e.message?.includes("NOT_FOUND")
    if (is404) {
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

      return res.json({
        provisioned: false,
        provider: refs.providerName,
        message: "Storefront project no longer exists",
      })
    }

    res.json({
      provisioned: true,
      provider: refs.providerName,
      project: { id: refs.projectRef, name: refs.vercelProjectName },
      domain: refs.storefrontDomain,
      storefront_url: refs.storefrontDomain
        ? `https://${refs.storefrontDomain}`
        : null,
      provisioned_at: refs.storefrontProvisionedAt,
      latest_deployment: null,
      error: `Could not fetch status: ${e.message}`,
    })
  }
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
