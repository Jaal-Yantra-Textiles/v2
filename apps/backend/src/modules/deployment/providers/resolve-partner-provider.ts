/**
 * resolveHostingProviderForPartner — the API-layer entry point for #884.
 *
 * Given a partner record, work out which hosting provider its storefront lives
 * on and hand back a ready-to-use HostingProvider (with the right credentials)
 * plus the provider-specific project reference to address it by. Partner/admin
 * routes call this instead of reaching for the env-single-account Vercel service
 * directly, so each provider's own domain/DNS methods get invoked.
 *
 * Credential resolution, in order:
 *   1. `partner.deployment_account_id` (S3) → load that deployment_account row,
 *      decrypt its token via the encryption module. This is the multi-account path.
 *   2. Legacy env fallback — the single-account creds the platform ran on before
 *      #884 (VERCEL_TOKEN/TEAM_ID, CLOUDFLARE_API_TOKEN/ACCOUNT_ID). Keeps every
 *      already-provisioned Vercel partner working with zero data migration.
 *
 * Provider selection:
 *   - `partner.hosting_provider` (S3 column) when set;
 *   - otherwise inferred as "vercel" (every partner provisioned before #884).
 */

import { MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework"

import { DEPLOYMENT_MODULE } from ".."
import type DeploymentService from "../service"
import { ENCRYPTION_MODULE } from "../../encryption"
import type EncryptionService from "../../encryption/service"
import { createHostingProvider, resolveAccountCredentials } from "./registry"
import type { HostingCredentials, HostingProvider, HostingProviderName } from "./types"

export type ResolvedPartnerHosting = {
  providerName: HostingProviderName
  provider: HostingProvider
  /** The id/name to address the project by on this provider (Vercel: project id; Cloudflare Workers: project name). */
  projectRef: string | null
  /** The deployment_account this resolved to, if any (null on the legacy env path). */
  accountId: string | null
}

/** Read a partner's provider, tolerating the pre-#884 records (column absent → vercel). */
export function partnerHostingProviderName(partner: any): HostingProviderName {
  const raw = (partner?.hosting_provider ??
    partner?.metadata?.hosting_provider) as string | undefined
  if (raw === "cloudflare" || raw === "render" || raw === "netlify" || raw === "vercel") {
    return raw
  }
  return "vercel"
}

/** The project reference to address the partner's storefront by, per provider. */
export function partnerProjectRef(partner: any, providerName: HostingProviderName): string | null {
  if (providerName === "cloudflare") {
    // Cloudflare Workers addresses projects by name.
    return (
      partner?.deployment_project_name ??
      partner?.vercel_project_name ??
      partner?.metadata?.vercel_project_name ??
      null
    )
  }
  // Vercel (and, until S5, render/netlify) address by the stored project id.
  return (
    partner?.deployment_project_id ??
    partner?.vercel_project_id ??
    partner?.metadata?.vercel_project_id ??
    null
  )
}

/** Legacy single-account creds from env, per provider (pre-#884 behaviour). */
function envCredentials(providerName: HostingProviderName): HostingCredentials {
  switch (providerName) {
    case "vercel": {
      const token = process.env.VERCEL_TOKEN
      if (!token) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "Vercel is not configured (VERCEL_TOKEN missing) and the partner has no deployment account"
        )
      }
      return { token, teamId: process.env.VERCEL_TEAM_ID || undefined }
    }
    case "cloudflare": {
      const token = process.env.CLOUDFLARE_API_TOKEN
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
      if (!token || !accountId) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "Cloudflare Workers is not configured (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID missing) and the partner has no deployment account"
        )
      }
      return { token, accountId }
    }
    default:
      // Netlify/Render have no legacy env-single-account path — they always run
      // via a deployment_account. Reaching here means the partner has no account.
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `Hosting provider "${providerName}" requires a deployment account (no env-single-account fallback)`
      )
  }
}

/**
 * Build a HostingProvider for a provider name + (optional) deployment_account.
 * The single credential-resolution seam used by both the per-partner resolver
 * and the provision workflow (S3):
 *   - accountId set → decrypt that account's token (multi-account rotation path)
 *   - accountId null → legacy env-single-account creds (pre-#884 behaviour)
 */
export async function buildHostingProvider(
  providerName: HostingProviderName,
  accountId: string | null,
  container: MedusaContainer
): Promise<HostingProvider> {
  let creds: HostingCredentials
  if (accountId) {
    const deployment = container.resolve(DEPLOYMENT_MODULE) as DeploymentService
    const account = await deployment.retrieveDeploymentAccount(accountId)
    const encryption = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    creds = resolveAccountCredentials((account as any)?.api_config, encryption)
  } else {
    creds = envCredentials(providerName)
  }
  return createHostingProvider(providerName, creds)
}

export async function resolveHostingProviderForPartner(
  partner: any,
  container: MedusaContainer
): Promise<ResolvedPartnerHosting> {
  const providerName = partnerHostingProviderName(partner)
  const projectRef = partnerProjectRef(partner, providerName)

  const accountId = (partner?.deployment_account_id ??
    partner?.metadata?.deployment_account_id ??
    null) as string | null

  const provider = await buildHostingProvider(providerName, accountId, container)
  return { providerName, provider, projectRef, accountId }
}
