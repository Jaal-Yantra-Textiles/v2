import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import partnerRegionLink from "../links/partner-region"

/**
 * Backfill `partner_region` links from `store.default_region_id` for
 * partners that don't yet have an explicit link to their default region.
 *
 * Why: PR feat/partner-regions-admin-parity makes the `partner_region`
 * link the SINGLE SOURCE OF TRUTH for "which regions does this partner
 * see/own", and removes the `store.default_region_id` fallback that
 * previous partner GET handlers relied on. Without this backfill, every
 * pre-PR-A partner whose store has a `default_region_id` but no explicit
 * link row would see an empty region list immediately after deploy.
 *
 * Idempotent: re-runs only create links that don't already exist. Safe
 * to invoke as part of every deployment.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-partner-region-links.ts
 *
 * Dry run — logs what would happen, creates nothing. Two equivalent ways:
 *   - Args:        npx medusa exec ./src/scripts/backfill-partner-region-links.ts -- --dry-run
 *   - Env var:     DRY_RUN=1 npx medusa exec ./src/scripts/backfill-partner-region-links.ts
 *
 * The env-var form is what deploy/aws/scripts/run-backfill.sh uses when
 * spawning a one-shot ECS task (the script sets DRY_RUN as a container
 * env var, not as a positional arg). Both forms are honored here.
 */
export default async function backfillPartnerRegionLinks({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

  const dryRun =
    (args ?? []).includes("--dry-run") || process.env.DRY_RUN === "1"
  if (dryRun) {
    logger.info("DRY RUN — no links will be created.")
  }

  // 1. Every partner with their stores' default_region_id.
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: [
      "id",
      "name",
      "handle",
      "stores.id",
      "stores.name",
      "stores.default_region_id",
    ],
  })

  if (!partners?.length) {
    logger.info("No partners found. Nothing to backfill.")
    return
  }

  // 2. Every existing partner_region link row — used to skip
  //    (partner_id, region_id) pairs that already have a link.
  const { data: existingLinks } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    fields: ["partner_id", "region_id"],
  })
  const linkKey = (pid: string, rid: string) => `${pid}::${rid}`
  const linked = new Set<string>(
    (existingLinks ?? []).map((l: any) => linkKey(l.partner_id, l.region_id))
  )

  // 3. Every valid region id — used to skip stores whose
  //    default_region_id points at a region that no longer exists
  //    (FK rot from a manual delete). Avoids remoteLink.create
  //    failures and surfaces the issue instead.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: ["id"],
  })
  const validRegionIds = new Set<string>((regions ?? []).map((r: any) => r.id))

  let created = 0
  let alreadyLinked = 0
  let storesWithoutDefault = 0
  let invalidRegionRef = 0
  const errors: Array<{ partner: string; store: string; error: string }> = []

  for (const partner of partners as any[]) {
    const stores = partner.stores ?? []
    if (!stores.length) {
      logger.info(
        `Partner "${partner.name}" (${partner.id}): no stores — skipping`
      )
      continue
    }

    for (const store of stores) {
      const regionId = store.default_region_id
      const tag = `partner "${partner.name}" (${partner.id}), store "${store.name}" (${store.id})`

      if (!regionId) {
        logger.info(`${tag}: store has no default_region_id — skipping`)
        storesWithoutDefault++
        continue
      }

      if (!validRegionIds.has(regionId)) {
        logger.warn(
          `${tag}: default_region_id ${regionId} does not point at any existing region — skipping`
        )
        invalidRegionRef++
        continue
      }

      if (linked.has(linkKey(partner.id, regionId))) {
        logger.info(`${tag}: already linked to region ${regionId} — skipping`)
        alreadyLinked++
        continue
      }

      if (dryRun) {
        logger.info(`${tag}: WOULD link partner → region ${regionId}`)
        created++
        continue
      }

      try {
        await remoteLink.create({
          partner: { partner_id: partner.id },
          [Modules.REGION]: { region_id: regionId },
        })
        // Update the in-memory set so a second store on the same
        // partner pointing at the same region doesn't double-create.
        linked.add(linkKey(partner.id, regionId))
        logger.info(`${tag}: created partner → region ${regionId} link`)
        created++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`${tag}: failed to create link — ${message}`)
        errors.push({ partner: partner.id, store: store.id, error: message })
      }
    }
  }

  logger.info(
    `Backfill complete. created=${created}, already_linked=${alreadyLinked}, stores_without_default_region=${storesWithoutDefault}, invalid_region_refs=${invalidRegionRef}, errors=${errors.length}${
      dryRun ? " (DRY RUN)" : ""
    }`
  )

  if (errors.length) {
    logger.error("Errors during backfill — review the log above:")
    for (const e of errors) {
      logger.error(`  partner=${e.partner} store=${e.store}: ${e.error}`)
    }
    // Surface as non-zero exit so deploy scripts can detect failures.
    process.exitCode = 1
  }
}
