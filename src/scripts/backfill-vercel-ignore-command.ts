import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { DEPLOYMENT_MODULE } from "../modules/deployment"
import type DeploymentService from "../modules/deployment/service"

/**
 * Backfill Vercel's "Ignored Build Step" command on existing storefront
 * projects so backend-only pushes to the parent repo don't trigger a build
 * on every partner's storefront.
 *
 * The command is evaluated at the root of the parent repo before each
 * deploy: exit 0 means "skip", any non-zero exit means "build". We skip
 * the build iff nothing under the storefront root directory (including
 * the submodule pointer) changed between HEAD^ and HEAD.
 *
 * Run: npx medusa exec ./src/scripts/backfill-vercel-ignore-command.ts
 *
 * Env:
 *   VERCEL_STOREFRONT_ROOT_DIR          default: apps/storefront-starter
 *   VERCEL_STOREFRONT_IGNORE_COMMAND    overrides the auto-generated command
 *   VERCEL_STOREFRONT_PROJECT_PREFIX    default: storefront-  (filter on name)
 *   DRY_RUN=1                           print plan, don't PATCH anything
 */
export default async function backfillVercelIgnoreCommand({
  container,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const deployment = container.resolve<DeploymentService>(DEPLOYMENT_MODULE)

  if (!deployment.isVercelConfigured()) {
    logger.error("VERCEL_TOKEN not set — aborting backfill")
    return
  }

  const rootDir = process.env.VERCEL_STOREFRONT_ROOT_DIR || "apps/storefront-starter"
  const ignoreCommand =
    process.env.VERCEL_STOREFRONT_IGNORE_COMMAND ||
    `git diff --quiet HEAD^ HEAD -- ${rootDir} || exit 1`
  const prefix = process.env.VERCEL_STOREFRONT_PROJECT_PREFIX || "storefront-"
  const dryRun = process.env.DRY_RUN === "1"

  logger.info(
    `[backfill-vercel-ignore] prefix=${prefix} rootDir=${rootDir} dryRun=${dryRun}`
  )
  logger.info(`[backfill-vercel-ignore] ignoreCommand: ${ignoreCommand}`)

  const projects = await deployment.listProjects({ prefix })
  if (!projects.length) {
    logger.info(
      `[backfill-vercel-ignore] no projects matching prefix "${prefix}" — nothing to do`
    )
    return
  }

  logger.info(
    `[backfill-vercel-ignore] found ${projects.length} project(s): ${projects
      .map((p) => p.name)
      .join(", ")}`
  )

  let updated = 0
  let skipped = 0
  let failed = 0

  for (const project of projects) {
    const label = `${project.name} (${project.id})`
    try {
      const existing = await deployment.getProject(project.id)
      const currentCmd =
        (existing as any).commandForIgnoringBuildStep as string | null | undefined

      if (currentCmd === ignoreCommand) {
        logger.info(`[skip] ${label} — already set`)
        skipped++
        continue
      }

      if (dryRun) {
        logger.info(
          `[dry] ${label} — would set commandForIgnoringBuildStep (current: ${
            currentCmd || "<none>"
          })`
        )
        updated++
        continue
      }

      await deployment.updateProject(project.id, { ignoreCommand })
      logger.info(`[ok]   ${label} — ignore command applied`)
      updated++
    } catch (e: any) {
      logger.error(`[fail] ${label} — ${e.message}`)
      failed++
    }
  }

  logger.info(
    `[backfill-vercel-ignore] done — updated=${updated} skipped=${skipped} failed=${failed}`
  )
}
