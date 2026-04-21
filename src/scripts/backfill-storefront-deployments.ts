import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../modules/deployment"
import type DeploymentService from "../modules/deployment/service"
import { WEBSITE_MODULE } from "../modules/website"
import type WebsiteService from "../modules/website/service"
import type PartnerService from "../modules/partner/service"

/**
 * Backfill existing partner storefronts onto the new deployment model:
 *
 *  - Copy vercel_project_id / vercel_project_name / storefront_domain from
 *    partner.metadata → partner table columns.
 *  - Populate storefront_repo / storefront_root_dir / storefront_branch
 *    from env defaults (or BACKFILL_STOREFRONT_* overrides).
 *  - Ensure a website row exists for each storefront_domain and that
 *    partner.website_id points at it.
 *  - Re-link the Vercel project to the new storefront repo and clear
 *    rootDirectory + commandForIgnoringBuildStep (the legacy monorepo
 *    hack).
 *  - Optionally trigger a fresh deployment (TRIGGER_DEPLOY=1).
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-storefront-deployments.ts
 *
 * Env:
 *   BACKFILL_STOREFRONT_REPO        default: VERCEL_STOREFRONT_REPO
 *   BACKFILL_STOREFRONT_ROOT_DIR    default: empty (repo root)
 *   BACKFILL_STOREFRONT_BRANCH      default: VERCEL_STOREFRONT_BRANCH or "main"
 *   BACKFILL_PARTNER_IDS            explicit comma-separated partner IDs to
 *                                    process (overrides the vercel_linked filter).
 *                                    Use this for targeted one-time migrations.
 *   DRY_RUN=1                        print plan, don't mutate anything
 *   TRIGGER_DEPLOY=1                 also trigger a fresh Vercel deployment
 *
 * Selection rules:
 *   - If BACKFILL_PARTNER_IDS is set → only those rows, regardless of flag.
 *   - Otherwise → only partners with vercel_linked=true.
 *   Partners without an explicit flag AND no id list are skipped, so
 *   half-provisioned records can't sneak in.
 */
export default async function backfillStorefrontDeployments({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const deployment = container.resolve<DeploymentService>(DEPLOYMENT_MODULE)
  const websiteService = container.resolve<WebsiteService>(WEBSITE_MODULE)
  const partnerService = container.resolve<PartnerService>("partner")

  if (!deployment.isVercelConfigured()) {
    logger.error("VERCEL_TOKEN not set — aborting backfill")
    return
  }

  const repo =
    process.env.BACKFILL_STOREFRONT_REPO ||
    process.env.VERCEL_STOREFRONT_REPO ||
    ""
  const rootDir = process.env.BACKFILL_STOREFRONT_ROOT_DIR ?? ""
  const branch =
    process.env.BACKFILL_STOREFRONT_BRANCH ||
    process.env.VERCEL_STOREFRONT_BRANCH ||
    "main"
  const dryRun = process.env.DRY_RUN === "1"
  const triggerDeploy = process.env.TRIGGER_DEPLOY === "1"
  const explicitIds = (process.env.BACKFILL_PARTNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (!repo) {
    logger.error(
      "BACKFILL_STOREFRONT_REPO or VERCEL_STOREFRONT_REPO must be set"
    )
    return
  }

  logger.info(
    `[backfill-storefront] repo=${repo} rootDir=${rootDir || "<root>"} branch=${branch} dryRun=${dryRun} triggerDeploy=${triggerDeploy}`
  )
  if (explicitIds.length) {
    logger.info(
      `[backfill-storefront] explicit partner ids: ${explicitIds.join(", ")}`
    )
  }

  // Select partners: explicit id list overrides, otherwise only vercel_linked=true
  const [allPartners] = await partnerService.listAndCountPartners({}, { take: 1000 })
  const partners = allPartners.filter((p: any) => {
    if (explicitIds.length) return explicitIds.includes(p.id)
    return p.vercel_linked === true
  })

  if (!partners.length) {
    if (explicitIds.length) {
      logger.warn(
        `[backfill-storefront] none of the provided partner ids matched: ${explicitIds.join(", ")}`
      )
    } else {
      logger.info(
        "[backfill-storefront] no partners with vercel_linked=true — pass BACKFILL_PARTNER_IDS to target specific rows"
      )
    }
    return
  }

  logger.info(`[backfill-storefront] found ${partners.length} partner(s) to process`)

  let updated = 0
  let failed = 0

  for (const partner of partners as any[]) {
    const label = `${partner.handle || partner.name || partner.id} (${partner.id})`
    try {
      const meta = (partner.metadata || {}) as Record<string, any>
      const domain = partner.storefront_domain || meta.storefront_domain
      const projectId = partner.vercel_project_id || meta.vercel_project_id
      const projectName = partner.vercel_project_name || meta.vercel_project_name

      if (!domain || !projectId) {
        logger.warn(`[skip] ${label} — missing domain or project id`)
        continue
      }

      // 1. Ensure website row exists for this domain and partner.website_id is linked
      let websiteId: string | null = partner.website_id || null
      const [existingWebsites] = await websiteService.listAndCountWebsites(
        { domain },
        { take: 1 }
      )
      let website = existingWebsites?.[0]
      if (!website) {
        if (dryRun) {
          logger.info(`[dry] ${label} — would create website row for ${domain}`)
        } else {
          website = await websiteService.createWebsites({
            domain,
            name: partner.name || domain,
            status: "Active",
          })
          logger.info(`[ok]   ${label} — created website ${website.id} for ${domain}`)
        }
      }
      if (website && !websiteId) websiteId = website.id

      // Ensure the alias table has a primary row for this domain
      if (!dryRun && websiteId) {
        await websiteService.ensurePrimaryWebsiteDomain(websiteId, domain)
      }

      // 2. Backfill partner columns (metadata → table) + new repo/branch defaults
      const patch: Record<string, any> = {
        storefront_domain: domain,
        vercel_project_id: projectId,
        vercel_project_name: projectName,
        vercel_linked: true,
        storefront_repo: partner.storefront_repo || repo,
        storefront_root_dir: partner.storefront_root_dir ?? (rootDir || null),
        storefront_branch: partner.storefront_branch || branch,
        website_id: websiteId,
      }
      if (dryRun) {
        logger.info(`[dry] ${label} — would update partner columns: ${JSON.stringify(patch)}`)
      } else {
        await partnerService.updatePartners({ id: partner.id, ...patch })
      }

      // 3. Re-link Vercel project to new repo and drop legacy rootDir/ignoreCommand
      if (dryRun) {
        logger.info(`[dry] ${label} — would relink Vercel project ${projectId} to ${repo} and clear rootDir/ignoreCommand`)
      } else {
        try {
          await deployment.relinkGitRepo(projectId, { gitRepo: repo })
        } catch (e: any) {
          logger.warn(`[warn] ${label} — relink failed: ${e.message}`)
        }
        await deployment.updateProject(projectId, {
          rootDirectory: rootDir || null,
          ignoreCommand: null,
        })
        logger.info(`[ok]   ${label} — vercel project ${projectId} updated`)
      }

      // 4. Optional: trigger a fresh deployment
      if (triggerDeploy && !dryRun && projectName) {
        try {
          const dep = await deployment.triggerDeployment({
            projectName,
            gitRepo: repo,
            ref: branch,
          })
          await partnerService.updatePartners({
            id: partner.id,
            vercel_last_deployment_id: dep.id,
          })
          logger.info(`[ok]   ${label} — deployment triggered (${dep.id})`)
        } catch (e: any) {
          logger.warn(`[warn] ${label} — deployment trigger failed: ${e.message}`)
        }
      }

      updated++
    } catch (e: any) {
      logger.error(`[fail] ${label} — ${e.message}`)
      failed++
    }
  }

  logger.info(
    `[backfill-storefront] done — processed=${updated} failed=${failed} (total=${partners.length})`
  )
}
