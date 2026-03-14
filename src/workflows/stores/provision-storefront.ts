import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import {
  createProject,
  setEnvironmentVariables,
  addDomain,
  triggerDeployment,
} from "../../lib/vercel"
import { ensureVercelCname } from "../../lib/cloudflare"
import PartnerService from "../../modules/partner/service"

export type ProvisionStorefrontInput = {
  partner_id: string
  handle: string
  publishable_key: string
  root_domain: string
  storefront_repo: string
  medusa_backend_url: string
  stripe_publishable_key: string
  existing_metadata: Record<string, any>
}

export type ProvisionStorefrontResult = {
  project: { id: string; name: string }
  domain: any
  dns: any
  deployment: { id: string; url: string; status: string }
  storefront_url: string
}

// Step 1: Create Vercel project
const createVercelProjectStep = createStep(
  "create-vercel-project",
  async (input: { handle: string; storefrontRepo: string }) => {
    const projectName = `storefront-${input.handle}`
    const project = await createProject({
      name: projectName,
      gitRepo: input.storefrontRepo,
      framework: "nextjs",
    })

    return new StepResponse(
      { id: project.id, name: project.name },
      { projectId: project.id }
    )
  }
)

// Step 2: Set environment variables on Vercel project
const setVercelEnvVarsStep = createStep(
  "set-vercel-env-vars",
  async (input: {
    projectId: string
    publishableKey: string
    medusaBackendUrl: string
    stripeKey: string
  }) => {
    await setEnvironmentVariables(input.projectId, [
      {
        key: "NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY",
        value: input.publishableKey,
        type: "plain",
        target: ["production", "preview"],
      },
      {
        key: "NEXT_PUBLIC_MEDUSA_BACKEND_URL",
        value: input.medusaBackendUrl,
        type: "plain",
        target: ["production", "preview"],
      },
      {
        key: "MEDUSA_BACKEND_URL",
        value: input.medusaBackendUrl,
        type: "plain",
        target: ["production", "preview"],
      },
      {
        key: "NEXT_PUBLIC_STRIPE_KEY",
        value: input.stripeKey,
        type: "plain",
        target: ["production", "preview"],
      },
    ])

    return new StepResponse({ success: true })
  }
)

// Step 3: Add custom domain to Vercel project
const addVercelDomainStep = createStep(
  "add-vercel-domain",
  async (input: { projectId: string; handle: string; rootDomain: string }) => {
    const domain = `${input.handle}.${input.rootDomain}`
    try {
      const result = await addDomain(input.projectId, domain)
      return new StepResponse(result)
    } catch (e: any) {
      return new StepResponse({
        name: domain,
        verified: false,
        error: e.message,
      })
    }
  }
)

// Step 4: Create Cloudflare CNAME record pointing to Vercel
const createCloudflareCnameStep = createStep(
  "create-cloudflare-cname",
  async (input: { subdomain: string; rootDomain: string }) => {
    try {
      const result = await ensureVercelCname(input.subdomain, input.rootDomain)
      return new StepResponse(result as any)
    } catch (e: any) {
      return new StepResponse({ action: "failed", error: e.message } as any)
    }
  }
)

// Step 5: Trigger Vercel production deployment
const triggerVercelDeploymentStep = createStep(
  "trigger-vercel-deployment",
  async (input: { handle: string; storefrontRepo: string }) => {
    const projectName = `storefront-${input.handle}`
    const deployment = await triggerDeployment({
      projectName,
      gitRepo: input.storefrontRepo,
      ref: "main",
    })

    return new StepResponse({
      id: deployment.id,
      url: deployment.url,
      status: deployment.readyState,
    })
  }
)

// Step 6: Save Vercel metadata to partner
const saveStorefrontMetadataStep = createStep(
  "save-storefront-metadata",
  async (
    input: {
      partnerId: string
      projectId: string
      projectName: string
      handle: string
      rootDomain: string
      existingMetadata: Record<string, any>
    },
    { container }
  ) => {
    const domain = `${input.handle}.${input.rootDomain}`
    const partnerService:PartnerService = container.resolve("partner")
    await partnerService.updatePartners({
      id: input.partnerId,
      metadata: {
        ...input.existingMetadata,
        vercel_project_id: input.projectId,
        vercel_project_name: input.projectName,
        storefront_domain: domain,
        storefront_provisioned_at: new Date().toISOString(),
      },
    })

    return new StepResponse({ success: true })
  }
)

export const provisionStorefrontWorkflow = createWorkflow(
  "provision-storefront",
  (input: ProvisionStorefrontInput) => {
    // Step 1: Create Vercel project
    const project = createVercelProjectStep({
      handle: input.handle,
      storefrontRepo: input.storefront_repo,
    })

    // Step 2: Set env vars
    setVercelEnvVarsStep({
      projectId: project.id,
      publishableKey: input.publishable_key,
      medusaBackendUrl: input.medusa_backend_url,
      stripeKey: input.stripe_publishable_key,
    })

    // Step 3: Add custom domain to Vercel
    const domainResult = addVercelDomainStep({
      projectId: project.id,
      handle: input.handle,
      rootDomain: input.root_domain,
    })

    // Step 4: Create Cloudflare CNAME
    const dnsResult = createCloudflareCnameStep({
      subdomain: input.handle,
      rootDomain: input.root_domain,
    })

    // Step 5: Trigger deployment
    const deployment = triggerVercelDeploymentStep({
      handle: input.handle,
      storefrontRepo: input.storefront_repo,
    })

    // Step 6: Save metadata
    saveStorefrontMetadataStep({
      partnerId: input.partner_id,
      projectId: project.id,
      projectName: project.name,
      handle: input.handle,
      rootDomain: input.root_domain,
      existingMetadata: input.existing_metadata,
    })

    return new WorkflowResponse({
      project,
      domain: domainResult,
      dns: dnsResult,
      deployment,
    } as unknown as ProvisionStorefrontResult)
  }
)
