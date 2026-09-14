import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import propagateRegionToPartnersWorkflow from "../workflows/regions/propagate-region-to-partners"

/**
 * Subscriber: partner.created → give the new partner every existing region.
 *
 * 🔴 The counterpart that was missing.
 *
 * `region-propagate.ts` fans a NEW region out to every existing partner. There
 * was nothing going the other way, so a partner created AFTER a region never
 * gained that region's `partner_region` link — not late, never. The gap is
 * permanent and grows with every partner who signs up.
 *
 * Measured on prod 2026-09-14 (#1998), and the shortfall maps exactly onto
 * region age:
 *
 * | region | created | links | missing |
 * |---|---|---:|---:|
 * | India | 2025-06-13 | 21/30 | 9 |
 * | America | 2025-08-02 | 21/30 | 9 |
 * | Indonesia | 2025-12-04 | 27/30 | 3 |
 * | Australia | 2025-12-27 | 27/30 | 3 |
 * | Israel | 2026-07-19 | 22/30 | 8 |
 *
 * The oldest regions are the most short, because the most partners have been
 * created since. `repair-partner-region-links` cannot fix it — that job only
 * diffs against `store.default_region_id`.
 *
 * 🔑 Reuses `propagateRegionToPartnersWorkflow` scoped to the one new partner
 * rather than reimplementing the link-and-currency logic. A region link is only
 * half the job: the partner's store also gains the region's currency in
 * `supported_currencies`, and a second implementation of that would drift from
 * the first. Same reason `lib/partner-location.ts` and `lib/run-variant.ts`
 * exist. #2062
 */
export default async function partnerPropagateRegionsHandler({
  event: { data },
  container,
}: SubscriberArgs<{ partner_id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const partnerId = data?.partner_id
  if (!partnerId) {
    logger.warn("[partner-propagate-regions] event carried no partner_id — skipping")
    return
  }

  let regionIds: string[] = []
  try {
    const { data: regions } = await query.graph({
      entity: "region",
      fields: ["id", "name"],
    })
    regionIds = (regions ?? []).map((r: any) => r?.id).filter(Boolean)
  } catch (err) {
    logger.error(
      `[partner-propagate-regions] could not list regions for partner ${partnerId}: ` +
        (err instanceof Error ? err.message : String(err))
    )
    return
  }

  if (!regionIds.length) {
    logger.info(
      `[partner-propagate-regions] partner ${partnerId}: no regions exist yet — nothing to link`
    )
    return
  }

  let linked = 0
  let alreadyLinked = 0
  const failed: string[] = []

  /**
   * One region at a time, and a failure on one must not cost the others. A
   * partner half-linked is better than a partner not linked at all, and the
   * next run of the same workflow is idempotent — it skips pairs that already
   * have a link.
   */
  for (const regionId of regionIds) {
    try {
      const { result } = await propagateRegionToPartnersWorkflow(container).run({
        input: { region_id: regionId, partner_ids: [partnerId] },
      })
      linked += result.links_created
      alreadyLinked += result.links_already_existing
    } catch (err) {
      failed.push(regionId)
      logger.error(
        `[partner-propagate-regions] partner ${partnerId} region ${regionId} failed: ` +
          (err instanceof Error ? err.message : String(err))
      )
    }
  }

  logger.info(
    `[partner-propagate-regions] partner ${partnerId}: ` +
      `${regionIds.length} region(s) scanned, ${linked} link(s) created, ` +
      `${alreadyLinked} already present` +
      (failed.length ? `, ${failed.length} failed (${failed.join(", ")})` : "")
  )
}

export const config: SubscriberConfig = {
  event: "partner.created",
}
