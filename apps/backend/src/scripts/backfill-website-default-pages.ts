/**
 * Backfill: default pages for every existing website.
 *
 * Some websites were created before the provisioning workflow seeded
 * Terms, Privacy, and Contact pages — or were created via paths that
 * skipped the seed step entirely. This script walks every website and
 * runs `seedDefaultPagesWorkflow` for each one. The seed workflow is
 * idempotent (it skips slugs that already exist), so this is safe to
 * re-run.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-website-default-pages.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { WEBSITE_MODULE } from "../modules/website"
import WebsiteService from "../modules/website/service"
import { seedDefaultPagesWorkflow } from "../workflows/website/seed-default-pages"

export default async function backfillWebsiteDefaultPages({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const websiteService: WebsiteService = container.resolve(WEBSITE_MODULE)

  const PAGE_SIZE = 100
  let offset = 0
  let totalWebsites = 0
  let totalCreated = 0
  let totalSkipped = 0
  const failures: Array<{ website_id: string; error: string }> = []

  logger.info("Backfilling default pages across all websites...")

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [websites] = await websiteService.listAndCountWebsites(
      {},
      { take: PAGE_SIZE, skip: offset, order: { created_at: "ASC" } },
    )
    if (!websites.length) break

    for (const website of websites) {
      totalWebsites++
      try {
        const { result } = await seedDefaultPagesWorkflow(container).run({
          input: { website_id: website.id },
        })
        const created = result?.pages?.length ?? 0
        const skipped = result?.skipped?.length ?? 0
        totalCreated += created
        totalSkipped += skipped
        if (created > 0) {
          logger.info(
            `  ${website.id} (${website.domain}) — created ${created}, skipped ${skipped}`,
          )
        }
      } catch (e: any) {
        failures.push({ website_id: website.id, error: e.message })
        logger.error(
          `  ${website.id} (${website.domain}) — failed: ${e.message}`,
        )
      }
    }

    if (websites.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  logger.info(
    `Done. Walked ${totalWebsites} websites — created ${totalCreated} pages, skipped ${totalSkipped} already-present, ${failures.length} failures.`,
  )

  if (failures.length > 0) {
    logger.warn(`Failed websites: ${failures.map((f) => f.website_id).join(", ")}`)
  }
}
