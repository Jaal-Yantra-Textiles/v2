import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { DEPLOYMENT_MODULE } from "../../modules/deployment"
import type DeploymentService from "../../modules/deployment/service"
import { resolveHostingProviderForPartner } from "../../modules/deployment/providers/resolve-partner-provider"
import { getStorefrontRefs } from "../../api/partners/storefront/helpers"

// #843 slice 5 — the partner storefront *hosting status*, lifted out of
// `GET /partners/storefront` into a workflow so the admin inspection route
// (`GET /admin/partners/:id/storefront`) runs the SAME logic instead of its own
// hand-rolled copy. That copy had already drifted: it was missing the
// shared-project handling, the `*_configured` flags, and the
// provider-not-resolvable branch. This workflow is the single answer to
// "what is the state of this partner's storefront hosting?".
//
// READ-ONLY BY CONSTRUCTION. The partner route performs two writes off the back
// of this status — backfilling nothing here, but clearing stale provider refs
// when the project has vanished. Those writes stay in the ROUTE, driven by the
// `stale_project` flag below, precisely so the admin mirror can report the same
// state without mutating a partner's record as a side effect of an operator
// opening a tab.

export type PartnerStorefrontStatus = {
  provisioned: boolean
  provider: string
  message?: string
  project?: { id: string | null; name: string | null }
  domain?: string | null
  storefront_url?: string | null
  provisioned_at?: string | null
  latest_deployment?: {
    id: string
    url: string
    status: string
    created_at: number
  } | null
  error?: string
  vercel_configured?: boolean
  cloudflare_configured?: boolean
  /**
   * The provider 404'd for a project we still hold a reference to — the refs are
   * stale. The partner route clears them; the admin mirror only reports it.
   */
  stale_project?: boolean
}

export type GetPartnerStorefrontStatusWorkflowInput = {
  /** The full partner record — read for its provider/project/domain columns. */
  partner: any
}

export const resolvePartnerStorefrontStatusStep = createStep(
  "resolve-partner-storefront-status",
  async (input: GetPartnerStorefrontStatusWorkflowInput, { container }) => {
    const { partner } = input
    const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
    const refs = getStorefrontRefs(partner)

    if (!refs.projectRef) {
      return new StepResponse({
        provisioned: false,
        provider: refs.providerName,
        message: "Storefront has not been provisioned yet",
        vercel_configured: deployment.isVercelConfigured(),
        cloudflare_configured: deployment.isCloudflareConfigured(),
      } as PartnerStorefrontStatus)
    }

    // Everything below reports against the refs we already hold, so a provider
    // outage degrades to "provisioned, detail unavailable" rather than an error.
    const base = {
      provisioned: true as const,
      provider: refs.providerName,
      domain: refs.storefrontDomain,
      storefront_url: refs.storefrontDomain
        ? `https://${refs.storefrontDomain}`
        : null,
      provisioned_at: refs.storefrontProvisionedAt,
    }

    let resolved: Awaited<ReturnType<typeof resolveHostingProviderForPartner>>
    try {
      resolved = await resolveHostingProviderForPartner(partner, container)
    } catch (e: any) {
      return new StepResponse({
        ...base,
        project: { id: refs.projectRef, name: refs.vercelProjectName },
        latest_deployment: null,
        error: `Hosting provider not resolvable: ${e.message}`,
      } as PartnerStorefrontStatus)
    }

    try {
      const project = await resolved.provider.getProject(refs.projectRef)

      let deploymentInfo: PartnerStorefrontStatus["latest_deployment"] = null

      // Vercel exposes latest-deployment detail via the legacy service client;
      // the provider interface's getProject stays minimal, so this is a
      // Vercel-only enhancement rather than part of the abstraction.
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

      return new StepResponse({
        ...base,
        project: { id: project.id, name: project.name },
        latest_deployment: deploymentInfo,
        vercel_configured: deployment.isVercelConfigured(),
        cloudflare_configured: deployment.isCloudflareConfigured(),
      } as PartnerStorefrontStatus)
    } catch (e: any) {
      // Project no longer exists on the provider — the refs we hold are stale.
      // Flagged, not acted on: see the module comment.
      const is404 =
        e.message?.includes("(404)") || e.message?.includes("NOT_FOUND")
      if (is404) {
        return new StepResponse({
          provisioned: false,
          provider: refs.providerName,
          message: "Storefront project no longer exists",
          stale_project: true,
        } as PartnerStorefrontStatus)
      }

      return new StepResponse({
        ...base,
        project: { id: refs.vercelProjectId, name: refs.vercelProjectName },
        latest_deployment: null,
        error: `Could not fetch storefront status: ${e.message}`,
      } as PartnerStorefrontStatus)
    }
  }
)

export const getPartnerStorefrontStatusWorkflow = createWorkflow(
  "get-partner-storefront-status",
  (input: GetPartnerStorefrontStatusWorkflowInput) => {
    const status = resolvePartnerStorefrontStatusStep(input)
    return new WorkflowResponse(status)
  }
)

export default getPartnerStorefrontStatusWorkflow
