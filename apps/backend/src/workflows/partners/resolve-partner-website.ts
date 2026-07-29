import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { WEBSITE_MODULE } from "../../modules/website"
import type WebsiteService from "../../modules/website/service"

// #843 slice 5 — resolving "which website is this partner's storefront",
// lifted out of `GET /partners/storefront/website` so the admin inspection
// mirror resolves it the same way.
//
// WHY THIS IS A *RESOLUTION* WORKFLOW AND NOT THE WHOLE ROUTE:
// the partner route's GET has a WRITE in it — when it falls back to a
// domain lookup it backfills `website_id` onto the partner record. A read-proxy
// must never do that, so the lookup is what moves here and the backfill stays
// in the partner route, driven by the `resolved_by` flag below. Same split as
// `get-partner-storefront-status`.

export type PartnerWebsiteResolution = {
  website: any | null
  /**
   * How the website was found — `domain` means the partner's `website_id` was
   * absent or stale, which is what the partner route backfills on. `null` when
   * nothing was found.
   */
  resolved_by: "website_id" | "domain" | null
  /** Present only when `website` is null, explaining which state this is. */
  reason?: "not_provisioned" | "no_website"
  message?: string
}

export type ResolvePartnerWebsiteWorkflowInput = {
  partner: any
}

const storefrontDomain = (partner: any): string | null =>
  partner?.storefront_domain || partner?.metadata?.storefront_domain || null

const websiteIdOf = (partner: any): string | null =>
  partner?.website_id || partner?.metadata?.website_id || null

export const resolvePartnerWebsiteStep = createStep(
  "resolve-partner-website",
  async (input: ResolvePartnerWebsiteWorkflowInput, { container }) => {
    const { partner } = input

    const domain = storefrontDomain(partner)
    if (!domain) {
      return new StepResponse({
        website: null,
        resolved_by: null,
        reason: "not_provisioned",
        message: "Storefront not provisioned",
      } as PartnerWebsiteResolution)
    }

    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)

    // 1. Direct lookup by website_id (table column, metadata fallback).
    const websiteId = websiteIdOf(partner)
    if (websiteId) {
      try {
        const website = await websiteService.retrieveWebsite(websiteId)
        if (website) {
          return new StepResponse({
            website,
            resolved_by: "website_id",
          } as PartnerWebsiteResolution)
        }
      } catch {
        // stale id — fall through to the domain lookup
      }
    }

    // 2. Fallback: lookup by storefront_domain.
    const [websites] = await websiteService.listAndCountWebsites(
      { domain },
      { take: 1 }
    )

    if (websites.length) {
      return new StepResponse({
        website: websites[0],
        resolved_by: "domain",
      } as PartnerWebsiteResolution)
    }

    return new StepResponse({
      website: null,
      resolved_by: null,
      reason: "no_website",
      message: "No website found. Create one from the Content section.",
    } as PartnerWebsiteResolution)
  }
)

export const resolvePartnerWebsiteWorkflow = createWorkflow(
  "resolve-partner-website",
  (input: ResolvePartnerWebsiteWorkflowInput) => {
    const resolution = resolvePartnerWebsiteStep(input)
    return new WorkflowResponse(resolution)
  }
)

export default resolvePartnerWebsiteWorkflow
