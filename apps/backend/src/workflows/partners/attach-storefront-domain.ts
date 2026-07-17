import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { WEBSITE_MODULE } from "../../modules/website"
import type WebsiteService from "../../modules/website/service"
import { PARTNER_MODULE } from "../../modules/partner"
import {
  partnerIsOnSharedProject,
  resolveHostingProviderForPartner,
} from "../../modules/deployment/providers/resolve-partner-provider"

/**
 * Roadmap #17 (issue #346) — a partner's custom domain should work in both
 * its www and apex forms. The submitted host is the canonical one; the
 * counterpart is attached to the same Vercel project as a permanent
 * redirect, and BOTH are registered as `website_domain` aliases so the
 * storefront's host-based website lookup resolves either form (the gap
 * that left sharlho.com showing the generic "Store" template).
 */

export type DomainPair = {
  /** The host the partner asked for — canonical, serves traffic. */
  primary: string
  /** The www/apex twin — redirects to primary. Null for deeper subdomains. */
  counterpart: string | null
}

/**
 * apex → www twin; www → apex twin; anything deeper (shop.example.com)
 * has no twin. Assumes an already-cleaned lowercase host.
 */
export function deriveDomainPair(domain: string): DomainPair {
  const parts = domain.split(".")
  if (parts[0] === "www" && parts.length === 3) {
    return { primary: domain, counterpart: parts.slice(1).join(".") }
  }
  if (parts.length === 2) {
    return { primary: domain, counterpart: `www.${domain}` }
  }
  return { primary: domain, counterpart: null }
}

export type AttachStorefrontDomainInput = {
  partner_id: string
  /** @deprecated kept for callers; the provider + project ref are now resolved from the partner. */
  vercel_project_id?: string
  website_id: string | null
  domain: string
  prev_metadata: Record<string, any>
}

/** Is this provider error just "the domain is already on this project"? */
const isAlreadyAttached = (message: string) =>
  /already in use by (one of )?your|domain_already_in_use|already exists/i.test(message)

type ProviderPairComp = { partner_id: string; created: string[] }
const addProviderDomainPairStep = createStep(
  "asd-add-provider-domain-pair",
  async (
    input: { partner_id: string; pair: DomainPair },
    { container }
  ) => {
    // Resolve which provider this partner's storefront is on (Vercel today,
    // Cloudflare Pages for new partners) and drive its own domain methods.
    const partnerService: any = container.resolve(PARTNER_MODULE)
    const partner = await partnerService.retrievePartner(input.partner_id)
    const { provider, projectRef } = await resolveHostingProviderForPartner(
      partner,
      container
    )
    if (!projectRef) {
      throw new Error(
        "Storefront has no project reference — cannot attach a custom domain"
      )
    }

    const created: string[] = []
    let verified = false
    let verification: any = null

    try {
      const res = await provider.addDomain(projectRef, input.pair.primary)
      verified = !!res.verified
      verification = res.verification || null
      created.push(input.pair.primary)
    } catch (e: any) {
      if (!isAlreadyAttached(String(e?.message || ""))) throw e
      verified = true // already attached to this project — treated as live
    }

    if (input.pair.counterpart) {
      try {
        // Vercel honours the redirect; Cloudflare Pages ignores it and attaches
        // the counterpart as a plain custom domain (see provider impl).
        await provider.addDomain(projectRef, input.pair.counterpart, {
          redirect: input.pair.primary,
          redirectStatusCode: 308,
        })
        created.push(input.pair.counterpart)
      } catch (e: any) {
        // The twin is best-effort: it may be parked on another project or
        // owned by someone else — that must not block the primary attach.
        if (!isAlreadyAttached(String(e?.message || ""))) {
          console.warn(
            `[attach-storefront-domain] counterpart ${input.pair.counterpart} not attached:`,
            e?.message
          )
        }
      }
    }

    return new StepResponse<
      { verified: boolean; verification: any; created: string[] },
      ProviderPairComp
    >(
      { verified, verification, created },
      { partner_id: input.partner_id, created }
    )
  },
  async (comp: ProviderPairComp | undefined, { container }) => {
    if (!comp?.created?.length) return
    const partnerService: any = container.resolve(PARTNER_MODULE)
    const partner = await partnerService.retrievePartner(comp.partner_id).catch(() => null)
    if (!partner) return
    const { provider, projectRef } = await resolveHostingProviderForPartner(
      partner,
      container
    ).catch(() => ({ provider: null as any, projectRef: null }))
    if (!provider || !projectRef) return
    for (const d of comp.created) {
      await provider.removeDomain(projectRef, d).catch(() => {})
    }
  }
)

/**
 * NEXT_PUBLIC_BASE_URL drives canonicals/sitemap/robots on the storefront
 * (see storefront-starter getBaseURL). Explicitly pinning it to the
 * partner's canonical host beats relying on VERCEL_PROJECT_PRODUCTION_URL,
 * which picks the *shortest* attached domain. Build-time var — takes
 * effect on the next deployment.
 */
const setBaseUrlEnvStep = createStep(
  "asd-set-base-url-env",
  async (
    input: { partner_id: string; primary: string },
    { container }
  ) => {
    const partnerService: any = container.resolve(PARTNER_MODULE)
    const partner = await partnerService.retrievePartner(input.partner_id)

    // Shared multi-tenant project: the base URL is resolved per-request from the
    // Host header, never pinned to one tenant. And on Cloudflare, setEnvVars
    // re-uploads the shared worker as a placeholder + wipes its bindings — which
    // takes every tenant down. Never touch the shared project's env. (This is the
    // bug that set NEXT_PUBLIC_BASE_URL=https://<partner-domain> on the shared
    // worker and broke hr-handloom + all tenants.)
    if (await partnerIsOnSharedProject(partner, container)) {
      return new StepResponse({ set: false, skipped: "shared" as const })
    }

    const { provider, projectRef } = await resolveHostingProviderForPartner(
      partner,
      container
    )
    if (!projectRef) return new StepResponse({ set: false })
    try {
      await provider.setEnvVars(projectRef, [
        {
          key: "NEXT_PUBLIC_BASE_URL",
          value: `https://${input.primary}`,
          target: ["production"],
        },
      ])
      return new StepResponse({ set: true })
    } catch (e: any) {
      // Non-fatal: canonical falls back to VERCEL_PROJECT_PRODUCTION_URL.
      console.warn("[attach-storefront-domain] env upsert failed:", e?.message)
      return new StepResponse({ set: false })
    }
  }
)

type MetadataComp = { partner_id: string; prev_metadata: Record<string, any> }
const updatePartnerDomainMetadataStep = createStep(
  "asd-update-partner-metadata",
  async (
    input: {
      partner_id: string
      prev_metadata: Record<string, any>
      domain: string
      verified: boolean
    },
    { container }
  ) => {
    const partnerService: any = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: input.partner_id,
      metadata: {
        ...(input.prev_metadata || {}),
        custom_domain: input.domain,
        custom_domain_verified: input.verified,
      },
    })
    return new StepResponse<{ ok: boolean }, MetadataComp>(
      { ok: true },
      { partner_id: input.partner_id, prev_metadata: input.prev_metadata }
    )
  },
  async (comp: MetadataComp | undefined, { container }) => {
    if (!comp) return
    const partnerService: any = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: comp.partner_id,
      metadata: comp.prev_metadata,
    })
  }
)

type AliasComp = { created_ids: string[] }
const registerWebsiteAliasesStep = createStep(
  "asd-register-website-aliases",
  async (
    input: { website_id: string | null; pair: DomainPair },
    { container }
  ) => {
    if (!input.website_id) {
      return new StepResponse<{ created: number }, AliasComp>(
        { created: 0 },
        { created_ids: [] }
      )
    }
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    const hosts = [input.pair.primary, input.pair.counterpart].filter(
      (h): h is string => !!h
    )
    const createdIds: string[] = []
    for (const host of hosts) {
      const [existing] = await (websiteService as any).listAndCountWebsiteDomains(
        { domain: host },
        { take: 1 }
      )
      if (!existing?.length) {
        const row = await (websiteService as any).createWebsiteDomains({
          domain: host,
          is_primary: false,
          website_id: input.website_id,
        })
        if (row?.id) createdIds.push(row.id)
      }
    }
    return new StepResponse<{ created: number }, AliasComp>(
      { created: createdIds.length },
      { created_ids: createdIds }
    )
  },
  async (comp: AliasComp | undefined, { container }) => {
    if (!comp?.created_ids?.length) return
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    for (const id of comp.created_ids) {
      await (websiteService as any).softDeleteWebsiteDomains(id).catch(() => {})
    }
  }
)

export const attachStorefrontDomainWorkflow = createWorkflow(
  "attach-storefront-domain",
  (input: AttachStorefrontDomainInput) => {
    const pair = transform({ input }, (d) => deriveDomainPair(d.input.domain))

    const pairInput = transform({ input, pair }, (d) => ({
      partner_id: d.input.partner_id,
      pair: d.pair,
    }))
    const attached = addProviderDomainPairStep(pairInput)

    const envInput = transform({ input, pair }, (d) => ({
      partner_id: d.input.partner_id,
      primary: d.pair.primary,
    }))
    setBaseUrlEnvStep(envInput)

    const metaInput = transform({ input, pair, attached }, (d) => ({
      partner_id: d.input.partner_id,
      prev_metadata: d.input.prev_metadata,
      domain: d.pair.primary,
      verified: d.attached.verified,
    }))
    updatePartnerDomainMetadataStep(metaInput)

    const aliasInput = transform({ input, pair }, (d) => ({
      website_id: d.input.website_id,
      pair: d.pair,
    }))
    const aliases = registerWebsiteAliasesStep(aliasInput)

    const result = transform({ pair, attached, aliases }, (d) => ({
      primary: d.pair.primary,
      counterpart: d.pair.counterpart,
      verified: d.attached.verified,
      verification: d.attached.verification,
      created_aliases: d.aliases.created,
    }))

    return new WorkflowResponse(result)
  }
)
