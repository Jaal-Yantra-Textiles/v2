import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { DEPLOYMENT_MODULE } from "../../modules/deployment"
import type DeploymentService from "../../modules/deployment/service"

/**
 * Bring a partner's provisioned `*.cicilabel.com` storefront domain to
 * VERIFIED on Vercel: publish the `_vercel` TXT challenge in our Cloudflare
 * zone (with the platform row's credentials) and ask Vercel to verify.
 *
 * Why it exists: `cicilabel.com` is claimed on another Vercel account, so a
 * fresh subdomain needs TXT proof, and until it is verified Vercel serves no
 * certificate — the storefront is simply down (shramdaan.cicilabel.com,
 * 2026-10-10). Provisioning publishes the TXT, but verification lags DNS
 * propagation, so this is also run on a schedule until it sticks.
 */
export type StorefrontDomainCheck = {
  partner_id: string
  domain: string | null
  project_id: string | null
  verified: boolean
  txt: Array<{ domain: string; action: string; id?: string; error?: string }>
  skipped?: string
  error?: string
}

export const storefrontProjectId = (partner: any): string | null =>
  partner?.vercel_project_id || partner?.metadata?.vercel_project_id || null

export async function verifyPartnerStorefrontDomain(
  container: MedusaContainer,
  partner: any
): Promise<StorefrontDomainCheck> {
  const domain: string | null =
    partner?.storefront_domain || partner?.metadata?.storefront_domain || null
  const projectId = storefrontProjectId(partner)
  const base = { partner_id: partner?.id, domain, project_id: projectId, verified: false, txt: [] }

  if (!domain) return { ...base, skipped: "no storefront domain" }
  if (!projectId) return { ...base, skipped: "no Vercel project" }

  const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
  if (!deployment.isVercelConfigured()) return { ...base, skipped: "Vercel not configured" }

  const r = await deployment.ensureVercelDomainVerified(projectId, domain, container)
  return { ...base, verified: r.verified, txt: r.txt, ...(r.error ? { error: r.error } : {}) }
}

/** Every partner with a provisioned storefront domain on Vercel. */
export async function listPartnersWithStorefrontDomain(container: MedusaContainer) {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "storefront_domain", "vercel_project_id", "metadata"],
  })
  return (data ?? []).filter(
    (p: any) =>
      (p.storefront_domain || p.metadata?.storefront_domain) && storefrontProjectId(p)
  )
}
