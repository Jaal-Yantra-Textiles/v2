import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import fanoutPricesWorkflow from "../workflows/fx/fanout-prices"

/**
 * Listens to `pricing.price.created`. When a partner adds a manual
 * price on a variant, fan that price out to the partner's other
 * supported currencies via the FX rates module.
 *
 * The workflow itself has the is_auto_converted guard — auto-prices
 * created by the fanout won't re-trigger it. Keeping the subscriber
 * thin: just decode the event, hand the price id to the workflow,
 * log the summary.
 *
 * Failure isolation: if the workflow throws for one price, we don't
 * want it to retry-storm and block the whole pricing event queue.
 * Wrap in try/catch + log so the subscriber always succeeds at the
 * event-bus level.
 */
export default async function fanoutFxPricesHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const priceId = data?.id
  if (!priceId) {
    logger.warn("[fanout-fx-prices] event payload missing price id; skipping")
    return
  }

  try {
    const { result } = await fanoutPricesWorkflow(container).run({
      input: { source_price_id: priceId },
    })

    if (result.skipped_reason) {
      logger.info(
        `[fanout-fx-prices] price ${priceId} skipped: ${result.skipped_reason}`
      )
      return
    }

    logger.info(
      `[fanout-fx-prices] price ${priceId}: created=${result.created_count}, ` +
        `already_priced=${result.skipped_currencies.length}, errors=${result.errors.length}`
    )
    if (result.errors.length) {
      for (const e of result.errors) {
        logger.warn(`  ${e.currency}: ${e.error}`)
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error(
      `[fanout-fx-prices] workflow failed for price ${priceId}: ${message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "pricing.price.created",
}
