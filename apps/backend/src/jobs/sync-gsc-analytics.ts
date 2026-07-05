import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../modules/socials"
import { syncSearchConsoleWorkflow } from "../workflows/google-search-console/sync-search-console"

export default async function syncGscAnalytics(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const socials: any = container.resolve(SOCIALS_MODULE)

  logger.info("[GSC Sync Job] Starting daily Search Console sync...")

  const bindings = await socials.listSocialPlatformBindings({
    service: "search-console",
  })

  if (!bindings?.length) {
    logger.info("[GSC Sync Job] No search-console bindings found — nothing to sync")
    return
  }

  const platformIds = new Set<string>(
    bindings.map((b: any) => b.platform_id)
  )

  let synced = 0
  let errors = 0

  for (const platformId of platformIds) {
    try {
      const { result } = await syncSearchConsoleWorkflow(container).run({
        input: {
          platform_id: platformId,
          window_days: 1,
        },
      })

      synced += result.sites_synced
      if (result.errors?.length) {
        errors += result.errors.length
        for (const err of result.errors) {
          logger.warn(
            `[GSC Sync Job] site error: ${err.site_url} — ${err.message}`
          )
        }
      }

      logger.info(
        `[GSC Sync Job] ✅ platform=${platformId} sites=${result.sites_synced} insights=${result.insights_rows_synced}`
      )
    } catch (e: any) {
      errors++
      logger.error(
        `[GSC Sync Job] ❌ platform=${platformId} failed: ${e?.message ?? e}`
      )
    }
  }

  logger.info(
    `[GSC Sync Job] ✅ Daily sync completed — ${synced} site(s) synced, ${errors} error(s)`
  )
}

export const config = {
  name: "sync-gsc-analytics",
  schedule: "0 2 * * *", // Every day at 2 AM (after aggregate-daily-analytics at 1 AM)
}
