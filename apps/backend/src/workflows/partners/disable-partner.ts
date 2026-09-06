import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PARTNER_MODULE } from "../../modules/partner"
import type PartnerService from "../../modules/partner/service"
import { DEPLOYMENT_MODULE } from "../../modules/deployment"
import type DeploymentService from "../../modules/deployment/service"
import { WEBSITE_MODULE } from "../../modules/website"
import type WebsiteService from "../../modules/website/service"
import { getStorefrontRefs } from "../../api/partners/storefront/helpers"
import {
  partnerIsOnSharedProject,
  resolveHostingProviderForPartner,
} from "../../modules/deployment/providers/resolve-partner-provider"
import {
  deriveDomainPair,
  partnerCustomDomain,
} from "./attach-storefront-domain"

export type DisablePartnerInput = {
  id: string
}

/**
 * The storefront keys that live in `metadata`. The empty string is
 * mergeMetadata's delete sentinel, so each is tombstoned explicitly rather than
 * left in place (a key simply omitted from the patch keeps its old value).
 */
const STOREFRONT_META_KEYS = [
  "vercel_project_id",
  "vercel_project_name",
  "storefront_domain",
  "storefront_provisioned_at",
  "custom_domain",
  "custom_domain_verified",
]

function stripStorefrontKeys(metadata: any): Record<string, any> {
  const current = (metadata || {}) as Record<string, any>
  const patch: Record<string, any> = {}
  for (const key of STOREFRONT_META_KEYS) {
    if (key in current) patch[key] = ""
  }
  return patch
}

/**
 * Read-only: load the partner (full record) or refuse before anything writes.
 */
export const resolveDisablePartnerStep = createStep(
  "resolve-disable-partner-step",
  async (input: DisablePartnerInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "partners",
      fields: ["*"],
      filters: { id: input.id },
    })
    const partner = (data ?? [])[0]
    if (!partner) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Partner with id ${input.id} was not found`
      )
    }
    return new StepResponse(partner)
  }
)

/**
 * Take the partner's storefront domains down at the provider + our DNS, WITHOUT
 * deleting the hosting project. A disabled partner is meant to be re-enableable,
 * so the project (and its refs) survive; only the domains are detached and the
 * public host resolution goes dark.
 */
export const removePartnerStorefrontDomainsStep = createStep(
  "remove-partner-storefront-domains-step",
  async (partner: any, { container }) => {
    const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
    const refs = getStorefrontRefs(partner)
    const storefrontDomain = refs.storefrontDomain
    const customDomain = partnerCustomDomain(partner)
    const projectRef = refs.projectRef

    const results: Record<string, any> = {}

    // Provider-side domain detach. A partner with no project ref has nothing to
    // detach from a provider — that is the dev/never-provisioned case, where the
    // domain only exists as a column we clear below.
    if (projectRef) {
      try {
        const { provider } = await resolveHostingProviderForPartner(
          partner,
          container
        )
        const isShared = await partnerIsOnSharedProject(partner, container)

        if (storefrontDomain) {
          try {
            await provider.removeDomain(projectRef, storefrontDomain)
            results.subdomain = { action: "removed" }
          } catch (e: any) {
            results.subdomain = { action: "failed", error: e?.message || String(e) }
          }
        }

        if (customDomain) {
          const pair = deriveDomainPair(customDomain)
          const hosts = [pair.primary, pair.counterpart].filter(
            (h): h is string => !!h
          )
          const warnings: string[] = []
          for (const host of hosts) {
            try {
              await provider.removeDomain(projectRef, host)
            } catch (e: any) {
              warnings.push(`${host}: ${e?.message || String(e)}`)
            }
          }
          results.custom_domain = {
            action: warnings.length ? "partial" : "removed",
            ...(warnings.length ? { warnings } : {}),
          }
        }

        // Shared multi-tenant project: the domain detach above is the whole job —
        // never tear down the project that serves every tenant.
        results.project = isShared
          ? { action: "skipped", reason: "shared multi-tenant project" }
          : { action: "kept", reason: "disable keeps the project for re-enable" }
      } catch (e: any) {
        results.domain = { action: "failed", error: e?.message || String(e) }
      }
    } else {
      results.domain = {
        action: "skipped",
        reason: "no hosting project reference to detach from",
      }
    }

    // Remove our Cloudflare DNS record for the provisioned subdomain.
    if (storefrontDomain) {
      results.dns = await deployment.removeStorefrontDns(storefrontDomain)
    }

    // Soft-delete the custom-domain alias rows so host lookups stop resolving it.
    if (customDomain) {
      try {
        const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
        const pair = deriveDomainPair(customDomain)
        const hosts = [pair.primary, pair.counterpart].filter(
          (h): h is string => !!h
        )
        for (const host of hosts) {
          const [rows] = await (websiteService as any).listAndCountWebsiteDomains(
            { domain: host },
            { take: 1 }
          )
          const row = rows?.[0]
          if (row && !row.is_primary) {
            await (websiteService as any).softDeleteWebsiteDomains(row.id)
          }
        }
      } catch {
        // best-effort — the column clear below is what matters for resolution
      }
    }

    return new StepResponse(results)
  }
)

/**
 * Flip the partner inactive and clear the storefront domain columns in one
 * write, so the record no longer advertises a domain it no longer serves.
 */
export const deactivatePartnerStep = createStep(
  "deactivate-partner-step",
  async (partner: any, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)

    const updated = await partnerService.updatePartners({
      id: partner.id,
      status: "inactive",
      storefront_domain: null,
      custom_domain: null,
      custom_domain_verified: false,
      metadata: stripStorefrontKeys(partner.metadata),
    } as any)

    return new StepResponse(updated as any, partner)
  },
  // Restore the prior status + domain fields on rollback.
  async (previous: any, { container }) => {
    if (!previous) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: previous.id,
      status: previous.status,
      storefront_domain: previous.storefront_domain ?? null,
      custom_domain: previous.custom_domain ?? null,
      custom_domain_verified: previous.custom_domain_verified ?? false,
      metadata: previous.metadata ?? null,
    } as any)
  }
)

/**
 * Disable a partner: take the storefront domains down and set `status` to
 * `inactive`. Deliberately NOT a delete — products, orders, admins and the
 * hosting project all survive so the partner can be re-enabled.
 */
export const disablePartnerWorkflow = createWorkflow(
  "disable-partner",
  (input: DisablePartnerInput) => {
    const partner = resolveDisablePartnerStep(input)
    const removed = removePartnerStorefrontDomainsStep(partner)
    const deactivated = deactivatePartnerStep(partner)

    return new WorkflowResponse({
      partner: deactivated,
      storefront: removed,
    })
  }
)

export default disablePartnerWorkflow