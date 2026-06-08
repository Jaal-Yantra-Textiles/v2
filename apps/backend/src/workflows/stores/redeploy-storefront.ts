import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { DEPLOYMENT_MODULE } from "../../modules/deployment"
import type DeploymentService from "../../modules/deployment/service"
import { PARTNER_MODULE } from "../../modules/partner"
import type PartnerService from "../../modules/partner/service"

export type RedeployStorefrontInput = {
  partner_id: string
  vercel_project_id: string
  vercel_project_name: string
  storefront_repo: string
  ref: string
  update_env?: boolean
}

/**
 * Build the storefront env vars from the partner's store/api-key + platform
 * config and push them to Vercel. Skipped unless `update_env` is set.
 * Env vars are idempotent on Vercel, so no compensation.
 */
const syncStorefrontEnvStep = createStep(
  "redeploy-sync-env",
  async (input: RedeployStorefrontInput, { container }) => {
    if (!input.update_env) {
      return new StepResponse({ synced: 0 })
    }
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: partnerWithStores } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.*"],
      filters: { id: input.partner_id },
    })
    const store = ((partnerWithStores?.[0] as any)?.stores || [])[0]
    const salesChannelId = store?.default_sales_channel_id

    const envVars: Array<{ key: string; value: string; type: "plain"; target: string[] }> = []
    const target = ["production", "preview"]

    if (salesChannelId) {
      const { data: apiKeys } = await query.graph({
        entity: "api_keys",
        fields: ["*", "sales_channels.*"],
        filters: { type: "publishable" },
      })
      const matchingKey = (apiKeys || []).find((key: any) =>
        (key.sales_channels || []).some((sc: any) => sc.id === salesChannelId)
      )
      if (matchingKey) {
        envVars.push({ key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY", value: matchingKey.token, type: "plain", target })
      }
    }

    // S3 image config for Next.js image optimization
    const fileUrl = process.env.S3_FILE_URL || ""
    const prefix = process.env.S3_PREFIX || ""
    let s3Hostname = process.env.MEDUSA_CLOUD_S3_HOSTNAME || ""
    let s3Pathname = process.env.MEDUSA_CLOUD_S3_PATHNAME || ""
    if (!s3Hostname && fileUrl) {
      try { s3Hostname = new URL(fileUrl).hostname } catch {}
    }
    if (!s3Pathname && prefix) {
      s3Pathname = `/${prefix.replace(/^\//, "")}**`
    }
    if (s3Hostname) envVars.push({ key: "MEDUSA_CLOUD_S3_HOSTNAME", value: s3Hostname, type: "plain", target })
    if (s3Pathname) envVars.push({ key: "MEDUSA_CLOUD_S3_PATHNAME", value: s3Pathname, type: "plain", target })

    const backendUrl = process.env.MEDUSA_BACKEND_URL || ""
    if (backendUrl) {
      envVars.push(
        { key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL", value: backendUrl, type: "plain", target },
        { key: "MEDUSA_BACKEND_URL", value: backendUrl, type: "plain", target },
      )
    }

    const stripeKey = process.env.NEXT_PUBLIC_STRIPE_KEY || ""
    if (stripeKey) {
      envVars.push({ key: "NEXT_PUBLIC_STRIPE_KEY", value: stripeKey, type: "plain", target })
    }

    if (envVars.length) {
      const svc: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
      await svc.setEnvironmentVariables(input.vercel_project_id, envVars)
    }
    return new StepResponse({ synced: envVars.length })
  }
)

/** Trigger the Vercel deployment. */
const triggerDeploymentStep = createStep(
  "redeploy-trigger",
  async (input: RedeployStorefrontInput, { container }) => {
    const svc: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
    const deployment = await svc.triggerDeployment({
      projectName: input.vercel_project_name,
      gitRepo: input.storefront_repo,
      ref: input.ref,
    })
    return new StepResponse({
      id: deployment.id,
      url: deployment.url,
      status: deployment.readyState,
    })
  }
)

/** Record the deployment id on the partner. Compensation restores prior id. */
type RecordComp = { partner_id: string; previous: string | null }
const recordDeploymentStep = createStep(
  "redeploy-record",
  async (input: { partner_id: string; deployment_id: string }, { container }) => {
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    const prev = (await partnerService.retrievePartner(input.partner_id)) as any
    await partnerService.updatePartners({
      id: input.partner_id,
      vercel_last_deployment_id: input.deployment_id,
    })
    return new StepResponse<{ ok: boolean }, RecordComp>(
      { ok: true },
      { partner_id: input.partner_id, previous: prev?.vercel_last_deployment_id ?? null }
    )
  },
  async (comp: RecordComp | undefined, { container }) => {
    if (!comp) return
    const partnerService: PartnerService = container.resolve(PARTNER_MODULE)
    await partnerService.updatePartners({
      id: comp.partner_id,
      vercel_last_deployment_id: comp.previous,
    })
  }
)

export const redeployStorefrontWorkflow = createWorkflow(
  "redeploy-storefront",
  (input: RedeployStorefrontInput) => {
    syncStorefrontEnvStep(input)
    const deployment = triggerDeploymentStep(input)
    recordDeploymentStep({ partner_id: input.partner_id, deployment_id: deployment.id })
    return new WorkflowResponse(deployment)
  }
)
