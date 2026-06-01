import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import partnerRegionLink from "../links/partner-region"

/**
 * Backfill `partner_region` links so every partner is linked to every
 * admin region.
 *
 * Why: Until a `region.created` subscriber lands (roadmap #0B), admin
 * regions don't propagate to existing partners. Live partner stores
 * (GOF, Ielo, …) only had `partner_region` rows for their own
 * `default_region_id`, so visitors from countries served by other
 * admin regions saw "we don't ship here" on the storefront. This
 * script unblocks them in one pass by cross-producting partners ×
 * regions.
 *
 * Companion of `backfill-partner-region-links.ts` (default-region
 * only). Run THIS one first when expanding partner region coverage,
 * then run `backfill-store-currencies-from-partner-regions.ts` to
 * extend `store.supported_currencies`, then the FX fanout sweep.
 *
 * Idempotent: skips any (partner, region) pair that already has a
 * link row. Safe to re-run.
 *
 * Run:
 *   npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts
 *
 * Dry run — logs what would happen, creates nothing:
 *   - Args:    npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts -- --dry-run
 *   - Env var: DRY_RUN=1 npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts
 *
 * Scope a subset of regions instead of every region:
 *   npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts -- --region-ids=reg_a,reg_b
 *   REGION_IDS=reg_a,reg_b npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts
 *
 * Scope a subset of partners (defaults to every partner):
 *   npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts -- --partner-ids=par_a,par_b
 *   PARTNER_IDS=par_a,par_b npx medusa exec ./src/scripts/backfill-all-admin-regions-to-partners.ts
 */
export default async function backfillAllAdminRegionsToPartners({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

  const argList = args ?? []
  const dryRun = argList.includes("--dry-run") || process.env.DRY_RUN === "1"

  const parseListArg = (flag: string, envVar: string): string[] | null => {
    const fromArg = argList
      .map((a) => (a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : null))
      .find((v): v is string => v !== null)
    const raw = fromArg ?? process.env[envVar] ?? ""
    if (!raw.trim()) return null
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const regionIdFilter = parseListArg("--region-ids", "REGION_IDS")
  const partnerIdFilter = parseListArg("--partner-ids", "PARTNER_IDS")

  if (dryRun) {
    logger.info("DRY RUN — no links will be created.")
  }
  if (regionIdFilter?.length) {
    logger.info(`Region scope: ${regionIdFilter.join(", ")}`)
  }
  if (partnerIdFilter?.length) {
    logger.info(`Partner scope: ${partnerIdFilter.join(", ")}`)
  }

  // 1. Target regions — either the scoped list or every admin region.
  const { data: allRegions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code"],
  })
  const targetRegions = (allRegions ?? []).filter(
    (r: any) => !regionIdFilter || regionIdFilter.includes(r.id)
  )

  if (!targetRegions.length) {
    logger.warn(
      regionIdFilter
        ? `No regions matched the --region-ids filter: ${regionIdFilter.join(", ")}`
        : "No admin regions found. Nothing to link."
    )
    return
  }

  logger.info(
    `Linking against ${targetRegions.length} region(s): ${targetRegions
      .map((r: any) => `${r.name} (${r.id}, ${r.currency_code})`)
      .join(", ")}`
  )

  // 2. Target partners.
  const { data: allPartners } = await query.graph({
    entity: "partners",
    fields: ["id", "name", "handle"],
  })
  const targetPartners = (allPartners ?? []).filter(
    (p: any) => !partnerIdFilter || partnerIdFilter.includes(p.id)
  )

  if (!targetPartners.length) {
    logger.warn(
      partnerIdFilter
        ? `No partners matched the --partner-ids filter: ${partnerIdFilter.join(", ")}`
        : "No partners found. Nothing to link."
    )
    return
  }

  // 3. Existing partner_region links — used to skip already-linked pairs.
  const { data: existingLinks } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    fields: ["partner_id", "region_id"],
  })
  const linkKey = (pid: string, rid: string) => `${pid}::${rid}`
  const linked = new Set<string>(
    (existingLinks ?? []).map((l: any) => linkKey(l.partner_id, l.region_id))
  )

  let created = 0
  let alreadyLinked = 0
  const errors: Array<{ partner: string; region: string; error: string }> = []

  for (const partner of targetPartners as any[]) {
    for (const region of targetRegions as any[]) {
      const tag = `partner "${partner.name}" (${partner.id}) → region "${region.name}" (${region.id})`

      if (linked.has(linkKey(partner.id, region.id))) {
        alreadyLinked++
        continue
      }

      if (dryRun) {
        logger.info(`${tag}: WOULD create link`)
        created++
        continue
      }

      try {
        await remoteLink.create({
          partner: { partner_id: partner.id },
          [Modules.REGION]: { region_id: region.id },
        })
        linked.add(linkKey(partner.id, region.id))
        logger.info(`${tag}: created link`)
        created++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`${tag}: failed — ${message}`)
        errors.push({ partner: partner.id, region: region.id, error: message })
      }
    }
  }

  logger.info(
    `Backfill complete. created=${created}, already_linked=${alreadyLinked}, partners=${targetPartners.length}, regions=${targetRegions.length}, errors=${errors.length}${
      dryRun ? " (DRY RUN)" : ""
    }`
  )

  if (errors.length) {
    logger.error("Errors during backfill — review the log above:")
    for (const e of errors) {
      logger.error(`  partner=${e.partner} region=${e.region}: ${e.error}`)
    }
    process.exitCode = 1
  }
}
