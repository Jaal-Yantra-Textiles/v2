import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import propagateRegionToPartnersWorkflow from "../workflows/regions/propagate-region-to-partners"

/**
 * Subscriber: region.created → propagate to every partner
 *
 * When admin creates a new region (India, Australia, …), every active
 * partner should automatically gain a `partner_region` link + the
 * region's currency in `store.supported_currencies`. Without this, new
 * regions only reach a partner when (a) someone re-runs the manual
 * 0A backfill scripts or (b) a partner creates a region of their own.
 *
 * The companion `region.updated` handler covers `currency_code` changes
 * on an existing region — rare but possible.
 *
 * FX fanout is gated behind `REGION_PROPAGATE_FANOUT=1` because it's
 * the expensive bulk path (per-variant workflow invocations, see the
 * 0A real run for cost) and not always needed: partners' next variant
 * save will fan out automatically via the existing batch-route hook.
 */
async function propagateRegionEvent(
  eventName: string,
  regionId: string,
  container: SubscriberArgs<{ id: string }>["container"]
) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const triggerFanout = process.env.REGION_PROPAGATE_FANOUT === "1"

  logger.info(
    `[region-propagate] ${eventName} for ${regionId} — propagating to partners (fanout=${triggerFanout})`
  )

  try {
    const { result } = await propagateRegionToPartnersWorkflow(container).run({
      input: { region_id: regionId, trigger_fanout: triggerFanout },
    })
    logger.info(
      `[region-propagate] ${eventName} for ${regionId} done. ` +
        `links_created=${result.links_created}, ` +
        `stores_currency_updated=${result.stores_currency_updated}, ` +
        `fanout_invocations=${result.fanout_invocations}, ` +
        `errors=${result.errors.length}`
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err)
    logger.error(
      `[region-propagate] ${eventName} for ${regionId} workflow threw: ${message}`
    )
  }
}

export default async function regionPropagateHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const regionId = event.data?.id
  if (!regionId) return
  await propagateRegionEvent(event.name, regionId, container)
}

export const config: SubscriberConfig = {
  event: ["region.created", "region.updated"],
}
