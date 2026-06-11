import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ExecArgs } from "@medusajs/framework/types"
import { DEPLOYMENT_MODULE } from "../modules/deployment"
import type DeploymentService from "../modules/deployment/service"
import { getStorefrontRefs } from "../api/partners/storefront/helpers"

/**
 * One-off: pin NEXT_PUBLIC_BASE_URL on every provisioned partner
 * storefront so canonicals/sitemap/robots resolve to the host that
 * actually SERVES traffic (roadmap #12/#17 — issues #349/#346).
 *
 * VERCEL_PROJECT_PRODUCTION_URL picks an arbitrary attached domain
 * (GOF's canonical came out as the internal cicilabel subdomain even
 * with gof.asia attached). The attach flow now pins the env var for
 * new domains (PR #374); this script catches up existing storefronts.
 *
 * Per provisioned partner (vercel_project_id present):
 *   - List the Vercel project's domains; serving candidates = entries
 *     with no redirect, excluding *.cicilabel.com / *.vercel.app.
 *   - Prefer the candidate matching metadata.custom_domain (or its
 *     www/apex twin); a single candidate wins by default; ambiguous or
 *     none → skip with a warning (nothing is guessed).
 *   - Upsert NEXT_PUBLIC_BASE_URL=https://<host> (production) and
 *     trigger a redeploy so the build-time var takes effect.
 *
 * Idempotent: re-running re-upserts the same value.
 *
 * Usage:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/set-storefront-base-url.ts
 *   npx medusa exec ./src/scripts/set-storefront-base-url.ts
 *   (scope) PARTNER_IDS=par_a,par_b
 */
export default async function setStorefrontBaseUrl({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const deployment: DeploymentService = container.resolve(DEPLOYMENT_MODULE)

  const dryRun = process.env.DRY_RUN === "1"
  const scope = (process.env.PARTNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  const token = process.env.VERCEL_TOKEN
  if (!token) {
    logger.error("[set-base-url] VERCEL_TOKEN is not set — aborting")
    process.exit(1)
  }
  const teamId = process.env.VERCEL_TEAM_ID
  const teamQuery = teamId ? `?teamId=${teamId}` : ""

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "handle", "metadata", "*"],
    ...(scope.length ? { filters: { id: scope } } : {}),
    pagination: { skip: 0, take: 200 },
  })

  const twin = (host: string): string | null => {
    const parts = host.split(".")
    if (parts[0] === "www" && parts.length === 3) return parts.slice(1).join(".")
    if (parts.length === 2) return `www.${host}`
    return null
  }

  let updated = 0
  let skipped = 0
  let errors = 0

  for (const partner of partners || []) {
    const refs = getStorefrontRefs(partner)
    const projectId = refs.vercelProjectId
    if (!projectId) continue

    const label = `${partner.name} (${partner.handle || partner.id})`
    try {
      const res = await fetch(
        `https://api.vercel.com/v9/projects/${projectId}/domains${teamQuery}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      if (!res.ok) {
        throw new Error(`domains list failed (${res.status}): ${await res.text()}`)
      }
      const { domains } = (await res.json()) as {
        domains: Array<{ name: string; redirect?: string | null }>
      }

      const candidates = (domains || [])
        .filter((d) => !d.redirect)
        .map((d) => d.name)
        .filter((n) => !n.endsWith(".cicilabel.com") && !n.endsWith(".vercel.app"))

      const customDomain = String(
        (partner as any).metadata?.custom_domain || ""
      ).toLowerCase()
      const preferred = candidates.find(
        (c) => c === customDomain || c === twin(customDomain)
      )
      const host =
        preferred || (candidates.length === 1 ? candidates[0] : null)

      if (!host) {
        logger.warn(
          `[set-base-url] SKIP ${label}: no unambiguous serving host (candidates: ${candidates.join(", ") || "none"})`
        )
        skipped++
        continue
      }

      if (dryRun) {
        logger.info(`[set-base-url] DRY ${label}: would pin https://${host} + redeploy`)
        updated++
        continue
      }

      await deployment.setEnvironmentVariables(projectId, [
        {
          key: "NEXT_PUBLIC_BASE_URL",
          value: `https://${host}`,
          target: ["production"],
        },
      ])

      const gitRepo =
        (partner as any).storefront_repo ||
        process.env.VERCEL_STOREFRONT_REPO ||
        ""
      const projectName = refs.vercelProjectName
      if (gitRepo && projectName) {
        await deployment.triggerDeployment({
          projectName,
          gitRepo,
          ref:
            (partner as any).storefront_branch ||
            process.env.VERCEL_STOREFRONT_BRANCH ||
            "main",
        })
        logger.info(`[set-base-url] OK ${label}: pinned https://${host}, redeploy triggered`)
      } else {
        logger.warn(
          `[set-base-url] ${label}: pinned https://${host} but no repo/projectName — redeploy manually`
        )
      }
      updated++
    } catch (e: any) {
      logger.error(`[set-base-url] ERROR ${label}: ${e?.message}`)
      errors++
    }
  }

  logger.info(
    `[set-base-url] done — updated: ${updated}, skipped: ${skipped}, errors: ${errors}${dryRun ? " (dry run)" : ""}`
  )
  if (errors > 0) process.exit(1)
}
