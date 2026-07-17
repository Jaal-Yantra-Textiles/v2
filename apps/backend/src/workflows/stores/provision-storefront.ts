import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/workflows-sdk"
import { MedusaError } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../../modules/deployment"
import type DeploymentService from "../../modules/deployment/service"
import {
  decideProvisionTarget,
  resolveProvisioningMode,
  type DeploymentAccountRow,
  type DeploymentProvider,
  type ProvisioningMode,
} from "../../modules/deployment/account-selector"
import { buildHostingProvider } from "../../modules/deployment/providers/resolve-partner-provider"
import type { HostingProviderName } from "../../modules/deployment/providers/types"
import PartnerService from "../../modules/partner/service"
import { WEBSITE_MODULE } from "../../modules/website"
import type WebsiteService from "../../modules/website/service"
import { seedDefaultPagesWorkflow } from "../website/seed-default-pages"

export type ProvisionStorefrontInput = {
  partner_id: string
  partner_name?: string
  handle: string
  publishable_key: string
  root_domain: string
  storefront_repo: string
  storefront_root_dir?: string
  storefront_branch?: string
  medusa_backend_url: string
  stripe_publishable_key: string
  s3_hostname: string
  s3_pathname: string
  /**
   * Preferred hosting provider for this NEW storefront. Defaults to
   * DEFAULT_HOSTING_PROVIDER env (or "cloudflare"). The selector rotates across
   * that provider's accounts, spills to other providers, then falls back to the
   * legacy env-single-account path.
   */
  preferred_provider?: DeploymentProvider
}

export type ProvisionStorefrontResult = {
  provider: HostingProviderName
  account_id: string | null
  project: { id: string; name: string }
  domain: any
  dns: any
  verification: any
  deployment: { id: string; url: string; status: string }
  storefront_url: string
}

// ── Which providers have legacy env-single-account creds configured? ─────────
function envConfiguredProviders(): DeploymentProvider[] {
  const out: DeploymentProvider[] = []
  if (process.env.VERCEL_TOKEN) out.push("vercel")
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
    out.push("cloudflare")
  }
  return out
}

// Step 1 (hosting): pick the account/provider this storefront provisions onto.
const selectHostingTargetStep = createStep(
  "select-hosting-target",
  async (
    input: { preferredProvider?: DeploymentProvider },
    { container }
  ) => {
    const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)

    const accounts = (await deployment.listDeploymentAccounts(
      {},
      { take: 1000 }
    )) as unknown as DeploymentAccountRow[]

    const preferred =
      input.preferredProvider ||
      (process.env.DEFAULT_HOSTING_PROVIDER as DeploymentProvider | undefined) ||
      "cloudflare"

    const target = decideProvisionTarget(accounts || [], {
      preferredProvider: preferred,
      envProviders: envConfiguredProviders(),
    })

    if (!target) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "No hosting capacity available — every deployment account is full/inactive and no legacy env provider is configured. Add or round-up an account."
      )
    }

    const accountId = target.kind === "account" ? target.accountId : null

    // Decide shared (attach-domain-only) vs dedicated (own deploy). Shared kicks
    // in only when a shared project id is configured on the chosen account's
    // api_config or via a <PROVIDER>_SHARED_PROJECT_ID env — so this is a no-op
    // until we actually stand up a shared multi-tenant project.
    const chosenAccount = accountId
      ? (accounts || []).find((a) => a.id === accountId)
      : undefined
    const { mode, sharedProjectId, sharedProjectName } = resolveProvisioningMode(
      target.provider,
      { apiConfig: chosenAccount?.api_config, env: process.env }
    )

    return new StepResponse({
      providerName: target.provider,
      accountId,
      mode,
      sharedProjectId,
      sharedProjectName,
    })
  }
)

// Step 2 (hosting): create the provider project (linked to the storefront repo).
const createProjectStep = createStep(
  "create-hosting-project",
  async (
    input: {
      providerName: HostingProviderName
      accountId: string | null
      handle: string
      storefrontRepo: string
      rootDirectory?: string
      branch?: string
      mode: ProvisioningMode
      sharedProjectId: string | null
      sharedProjectName: string | null
    },
    { container }
  ) => {
    // Shared mode: the multi-tenant project is already deployed and owned by us —
    // provisioning a partner is just attaching their domain later. Return the
    // shared project ref WITHOUT creating/deploying anything, and register NO
    // compensation (never tear the shared project down).
    if (input.mode === "shared" && input.sharedProjectId) {
      return new StepResponse(
        {
          id: input.sharedProjectId,
          name: input.sharedProjectName || input.sharedProjectId,
          originHost: null,
        },
        null
      )
    }

    const provider = await buildHostingProvider(
      input.providerName,
      input.accountId,
      container
    )
    const projectName = `storefront-${input.handle}`
    const branch = input.branch || "main"
    const project = await provider.createProject({
      name: projectName,
      gitRepo: input.storefrontRepo,
      framework: "nextjs",
      rootDirectory: input.rootDirectory,
      productionBranch: branch,
      installCommand: "pnpm install --no-frozen-lockfile",
      // Build ONLY the production branch. The storefront repo is the shared
      // monorepo, so without this every push to any feature branch fans out a
      // preview build to every storefront project (#1027). Vercel ignore-step
      // semantics: exit 1 => build, exit 0 => skip. (No-op on providers that
      // don't consume ignoreCommand.)
      ignoreCommand: `if [ "$VERCEL_GIT_COMMIT_REF" = "${branch}" ]; then exit 1; else exit 0; fi`,
    })

    return new StepResponse(
      { id: project.id, name: project.name, originHost: project.originHost ?? null },
      {
        projectId: project.id,
        providerName: input.providerName,
        accountId: input.accountId,
      }
    )
  },
  // Compensation: best-effort remove the project if a later step fails.
  async (state, { container }) => {
    if (!state?.projectId) return
    try {
      const provider = await buildHostingProvider(
        state.providerName,
        state.accountId,
        container
      )
      // Not all providers expose delete on the interface yet; guard.
      const anyProvider = provider as any
      if (typeof anyProvider.deleteProject === "function") {
        await anyProvider.deleteProject(state.projectId)
      }
    } catch {
      // best-effort
    }
  }
)

// Step 3 (hosting): set env vars on the project.
const setEnvVarsStep = createStep(
  "set-hosting-env-vars",
  async (
    input: {
      providerName: HostingProviderName
      accountId: string | null
      projectId: string
      publishableKey: string
      medusaBackendUrl: string
      stripeKey: string
      s3Hostname: string
      s3Pathname: string
      mode: ProvisioningMode
    },
    { container }
  ) => {
    // Shared mode: the one shared deploy carries NEXT_PUBLIC_MULTI_TENANT + the
    // backend URL already; the per-tenant publishable key is resolved at runtime
    // (/web/storefront/resolve). Nothing per-partner to set — and re-uploading
    // env vars would clobber the shared project's config.
    if (input.mode === "shared") {
      return new StepResponse({ success: true })
    }

    const provider = await buildHostingProvider(
      input.providerName,
      input.accountId,
      container
    )

    const envVars: Array<{
      key: string
      value: string
      type: "plain"
      target: string[]
    }> = [
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
    ]

    if (input.s3Hostname) {
      envVars.push({
        key: "MEDUSA_CLOUD_S3_HOSTNAME",
        value: input.s3Hostname,
        type: "plain",
        target: ["production", "preview"],
      })
    }
    if (input.s3Pathname) {
      envVars.push({
        key: "MEDUSA_CLOUD_S3_PATHNAME",
        value: input.s3Pathname,
        type: "plain",
        target: ["production", "preview"],
      })
    }

    await provider.setEnvVars(input.projectId, envVars)
    return new StepResponse({ success: true })
  }
)

// Step 4 (hosting): add the storefront subdomain as a custom domain.
const addDomainStep = createStep(
  "add-hosting-domain",
  async (
    input: {
      providerName: HostingProviderName
      accountId: string | null
      projectId: string
      handle: string
      rootDomain: string
    },
    { container }
  ) => {
    const provider = await buildHostingProvider(
      input.providerName,
      input.accountId,
      container
    )
    const domain = `${input.handle}.${input.rootDomain}`
    try {
      const result = await provider.addDomain(input.projectId, domain)
      return new StepResponse(result)
    } catch (e: any) {
      return new StepResponse({ name: domain, verified: false, error: e.message })
    }
  }
)

// Step 5a: Create the Cloudflare DNS record (our platform zone) pointing the
// subdomain at the provider origin. Vercel uses the per-project recommendation;
// other providers CNAME to their fixed origin host (provider.dnsTarget).
const createCnameStep = createStep(
  "create-storefront-cname",
  async (
    input: {
      providerName: HostingProviderName
      accountId: string | null
      subdomain: string
      rootDomain: string
      projectId: string
      projectName: string
      originHost: string | null
    },
    { container }
  ) => {
    const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
    const fullDomain = `${input.subdomain}.${input.rootDomain}`
    try {
      if (input.providerName === "vercel") {
        // Vercel's per-project CNAME recommendation (e.g. <hash>.vercel-dns-017.com).
        const result = await deployment.applyRecommendedDns(fullDomain)
        console.log("[provision-storefront] DNS (vercel recommended):", JSON.stringify(result))
        return new StepResponse(result as any)
      }
      if (input.providerName === "cloudflare") {
        // Cloudflare Workers attaches the hostname via a Custom Domain binding
        // (addDomainStep → Workers Domains API), which creates the correct
        // proxied route in-zone automatically. Adding our own grey-cloud CNAME
        // to `<worker>.<sub>.workers.dev` on top is a cross-account CNAME into
        // Cloudflare's shared workers.dev zone → the storefront 1014s
        // ("CNAME Cross-User Banned"). So the CNAME step is a no-op here.
        console.log(
          `[provision-storefront] DNS (cloudflare): skipped — routed via Workers Custom Domain, no workers.dev CNAME (avoids Error 1014)`
        )
        return new StepResponse({
          action: "skipped",
          reason: "cloudflare workers custom domain handles routing",
        } as any)
      }
      const provider = await buildHostingProvider(
        input.providerName,
        input.accountId,
        container
      )
      const target = provider.dnsTarget({
        id: input.projectId,
        name: input.projectName,
        originHost: input.originHost ?? undefined,
      })
      const result = await deployment.ensureCname(fullDomain, target)
      console.log(
        `[provision-storefront] DNS (${input.providerName} CNAME → ${target}):`,
        JSON.stringify(result)
      )
      return new StepResponse(result as any)
    } catch (e: any) {
      console.error("[provision-storefront] DNS error:", e.message)
      return new StepResponse({ action: "failed", error: e.message } as any)
    }
  }
)

// Step 5b: Create provider domain-verification DNS records (Vercel TXT etc.).
// No-op when the provider returned no verification records (Cloudflare/Netlify/
// Render verify via the CNAME resolving).
const createVerificationRecordsStep = createStep(
  "create-verification-records",
  async (
    input: { verification: Array<{ type: string; domain: string; value: string }> | null },
    { container }
  ) => {
    const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
    try {
      const results = await deployment.createVercelVerificationRecords(
        input.verification || undefined
      )
      return new StepResponse(results)
    } catch (e: any) {
      return new StepResponse([{ domain: "unknown", action: "failed", error: e.message }])
    }
  }
)

// Step 6 (hosting): trigger a production deployment.
const triggerDeploymentStep = createStep(
  "trigger-hosting-deployment",
  async (
    input: {
      providerName: HostingProviderName
      accountId: string | null
      projectId: string
      projectName: string
      storefrontRepo: string
      branch?: string
      mode: ProvisioningMode
    },
    { container }
  ) => {
    // Shared mode: WE deploy the shared multi-tenant project from our own CI —
    // never per partner. Attaching the domain (addDomainStep) is all that's
    // needed for the tenant to render.
    if (input.mode === "shared") {
      return new StepResponse({
        id: "shared",
        url: "",
        status: "shared",
      })
    }

    const provider = await buildHostingProvider(
      input.providerName,
      input.accountId,
      container
    )
    const result = await provider.triggerDeployment({
      projectName: input.projectName,
      projectId: input.projectId,
      gitRepo: input.storefrontRepo,
      ref: input.branch || "main",
    })

    return new StepResponse({
      id: result.id,
      url: result.url,
      status: result.status,
    })
  }
)

// Step 7: Save storefront state to the partner (source of truth = columns).
// Stamps the provider-agnostic columns + keeps vercel_* in sync for Vercel so
// pre-#884 read helpers keep working. Strips legacy metadata keys.
const LEGACY_STOREFRONT_METADATA_KEYS = [
  "vercel_project_id",
  "vercel_project_name",
  "vercel_last_deployment_id",
  "storefront_domain",
  "storefront_provisioned_at",
] as const

const saveStorefrontMetadataStep = createStep(
  "save-storefront-metadata",
  async (
    input: {
      partnerId: string
      providerName: HostingProviderName
      accountId: string | null
      projectId: string
      projectName: string
      handle: string
      rootDomain: string
      storefrontRepo: string
      storefrontRootDir?: string
      storefrontBranch?: string
      lastDeploymentId?: string
    },
    { container }
  ) => {
    const domain = `${input.handle}.${input.rootDomain}`
    const partnerService: PartnerService = container.resolve("partner")

    const existing = await partnerService.retrievePartner(input.partnerId)
    const currentMeta = (existing?.metadata || {}) as Record<string, any>
    const cleanedMeta: Record<string, any> = {}
    for (const [k, v] of Object.entries(currentMeta)) {
      if (!(LEGACY_STOREFRONT_METADATA_KEYS as readonly string[]).includes(k)) {
        cleanedMeta[k] = v
      }
    }

    const isVercel = input.providerName === "vercel"

    await partnerService.updatePartners({
      id: input.partnerId,
      storefront_domain: domain,
      // Provider-agnostic source of truth (S3):
      hosting_provider: input.providerName,
      deployment_account_id: input.accountId ?? null,
      deployment_project_id: input.projectId,
      deployment_project_name: input.projectName,
      // Keep vercel_* in sync for Vercel partners so legacy reads still resolve.
      vercel_project_id: isVercel ? input.projectId : null,
      vercel_project_name: isVercel ? input.projectName : null,
      vercel_last_deployment_id: isVercel ? input.lastDeploymentId ?? null : null,
      vercel_linked: isVercel,
      storefront_repo: input.storefrontRepo,
      storefront_root_dir: input.storefrontRootDir ?? null,
      storefront_branch: input.storefrontBranch ?? "main",
      metadata: Object.keys(cleanedMeta).length > 0 ? cleanedMeta : null,
    })

    return new StepResponse({ success: true })
  }
)

// Step 8: Increment the chosen account's live project_count (rotation load).
// Only when we provisioned onto a real deployment_account (not the env path).
const incrementAccountCountStep = createStep(
  "increment-account-count",
  async (
    input: { accountId: string | null; mode: ProvisioningMode },
    { container }
  ) => {
    if (!input.accountId) return new StepResponse({ incremented: false }, null)
    // Shared mode adds no new project to the account — one shared project holds
    // unlimited tenant domains — so it doesn't consume a rotation/cutoff slot.
    if (input.mode === "shared") return new StepResponse({ incremented: false }, null)
    const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
    const account = await deployment.retrieveDeploymentAccount(input.accountId)
    const next = ((account as any)?.project_count ?? 0) + 1
    await deployment.updateDeploymentAccounts({ id: input.accountId, project_count: next })
    return new StepResponse({ incremented: true }, input.accountId)
  },
  // Compensation: roll the count back down.
  async (accountId, { container }) => {
    if (!accountId) return
    try {
      const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)
      const account = await deployment.retrieveDeploymentAccount(accountId)
      const next = Math.max(0, ((account as any)?.project_count ?? 1) - 1)
      await deployment.updateDeploymentAccounts({ id: accountId, project_count: next })
    } catch {
      // best-effort
    }
  }
)

// Step: Create website record for the storefront domain (provider-neutral).
const createWebsiteRecordStep = createStep(
  "create-website-record",
  async (
    input: {
      handle: string
      rootDomain: string
      partnerName: string
      partnerId: string
    },
    { container }
  ) => {
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    const domain = `${input.handle}.${input.rootDomain}`

    const [existing] = await websiteService.listAndCountWebsites({ domain }, { take: 1 })
    if (existing.length) {
      return new StepResponse({ website: existing[0], created: false }, null)
    }

    const website = await websiteService.createWebsites({
      domain,
      name: input.partnerName || domain,
      status: "Active",
    })

    await websiteService.ensurePrimaryWebsiteDomain(website.id, domain)

    const partnerService: PartnerService = container.resolve("partner")
    await partnerService.updatePartners({ id: input.partnerId, website_id: website.id })

    return new StepResponse({ website, created: true }, website.id)
  },
  async (websiteId, { container }) => {
    if (!websiteId) return
    const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)
    try {
      await websiteService.softDeleteWebsites(websiteId)
    } catch {
      // best-effort rollback
    }
  }
)

// Step: Seed default pages for the website (idempotent, non-fatal).
const seedDefaultWebsitePagesStep = createStep(
  "seed-default-website-pages",
  async (input: { websiteId: string }, { container }) => {
    try {
      const { result } = await seedDefaultPagesWorkflow(container).run({
        input: { website_id: input.websiteId },
      })
      return new StepResponse({ pages: result?.pages, skipped_slugs: result?.skipped })
    } catch (e: any) {
      console.error("[provision-storefront] Page seeding failed:", e.message)
      return new StepResponse({
        pages: [] as { id: string; title: string; slug: string; blocks_created: number }[],
        skipped_slugs: [] as string[],
      })
    }
  }
)

export const provisionStorefrontWorkflow = createWorkflow(
  "provision-storefront",
  (input: ProvisionStorefrontInput) => {
    // Website row first so /web/website/{domain}/* never races a missing row.
    const websiteResult = createWebsiteRecordStep({
      handle: input.handle,
      rootDomain: input.root_domain,
      partnerName: input.partner_name as unknown as string,
      partnerId: input.partner_id,
    })

    seedDefaultWebsitePagesStep({
      websiteId: websiteResult.website.id as unknown as string,
    })

    // Pick provider/account (rotation; default Cloudflare Pages; env fallback).
    const target = selectHostingTargetStep({
      preferredProvider: input.preferred_provider,
    })

    // Create the provider project (linked to the storefront repo). In shared
    // mode this is a no-op returning the shared project ref.
    const project = createProjectStep({
      providerName: target.providerName,
      accountId: target.accountId,
      handle: input.handle,
      storefrontRepo: input.storefront_repo,
      rootDirectory: input.storefront_root_dir,
      branch: input.storefront_branch,
      mode: target.mode,
      sharedProjectId: target.sharedProjectId,
      sharedProjectName: target.sharedProjectName,
    })

    // Env vars (skipped in shared mode).
    setEnvVarsStep({
      providerName: target.providerName,
      accountId: target.accountId,
      projectId: project.id,
      publishableKey: input.publishable_key,
      medusaBackendUrl: input.medusa_backend_url,
      stripeKey: input.stripe_publishable_key,
      s3Hostname: input.s3_hostname,
      s3Pathname: input.s3_pathname,
      mode: target.mode,
    })

    // Custom domain.
    const domainResult = addDomainStep({
      providerName: target.providerName,
      accountId: target.accountId,
      projectId: project.id,
      handle: input.handle,
      rootDomain: input.root_domain,
    })

    // DNS: CNAME (our zone) → provider origin.
    const dnsResult = createCnameStep({
      providerName: target.providerName,
      accountId: target.accountId,
      subdomain: input.handle,
      rootDomain: input.root_domain,
      projectId: project.id,
      projectName: project.name,
      originHost: project.originHost,
    })

    // Verification DNS records (Vercel TXT; no-op otherwise).
    const verificationResult = createVerificationRecordsStep({
      verification: domainResult.verification as any,
    })

    // Trigger production deployment (skipped in shared mode — we deploy the
    // shared project from our own CI).
    const deployment = triggerDeploymentStep({
      providerName: target.providerName,
      accountId: target.accountId,
      projectId: project.id,
      projectName: project.name,
      storefrontRepo: input.storefront_repo,
      branch: input.storefront_branch,
      mode: target.mode,
    })

    // Save partner storefront state (source of truth = columns).
    saveStorefrontMetadataStep({
      partnerId: input.partner_id,
      providerName: target.providerName,
      accountId: target.accountId,
      projectId: project.id,
      projectName: project.name,
      handle: input.handle,
      rootDomain: input.root_domain,
      storefrontRepo: input.storefront_repo,
      storefrontRootDir: input.storefront_root_dir,
      storefrontBranch: input.storefront_branch,
      lastDeploymentId: deployment.id as unknown as string,
    })

    // Bump the account's rotation load (skipped in shared mode — no new project).
    incrementAccountCountStep({ accountId: target.accountId, mode: target.mode })

    return new WorkflowResponse({
      provider: target.providerName,
      account_id: target.accountId,
      project,
      domain: domainResult,
      dns: dnsResult,
      verification: verificationResult,
      deployment,
    } as unknown as ProvisionStorefrontResult)
  }
)
