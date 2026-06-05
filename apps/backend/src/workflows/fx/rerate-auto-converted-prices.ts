import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { FX_RATES_MODULE } from "../../modules/fx_rates"
import FxRatesService from "../../modules/fx_rates/service"

/**
 * Workflow: rerate-auto-converted-prices
 *
 * Daily companion to refresh-fx-rates: walks every fx_price_meta row
 * (which by definition is attached to an auto-converted Price), grabs
 * the linked Price's currency, computes a fresh converted amount
 * (base_amount × today's rate), and updates the Price + the meta's
 * cached fx_rate.
 *
 * Why base_amount lives on fx_price_meta:
 *   We snapshot the partner's source amount at fanout time
 *   (`base_amount = source.amount`). Re-rate uses this snapshot so
 *   the daily refresh is one round-trip per price — no need to
 *   re-resolve the source price every time. If the partner edits the
 *   source between two re-rate runs the new fanout-from-route flow
 *   refreshes the snapshot on the next save (it creates a new meta
 *   row for any newly auto-converted price). Re-rate uses whatever's
 *   currently in the snapshot.
 *
 * Manual overrides are untouched: when a partner edits a previously
 * auto-converted cell, the strip-on-edit DELETE removes both the
 * fx_price_meta row and the link, so re-rate's listFxPriceMetas()
 * query won't see it.
 *
 * Per-row failure isolation: a missing FX rate for one currency pair
 * doesn't abort the whole re-rate.
 */

export type RerateAutoPricesInput = Record<string, unknown> | undefined

export type RerateAutoPricesOutput = {
  scanned: number
  updated: number
  skipped: number
  errors: Array<{ fx_price_meta_id: string; error: string }>
}

const rerateAutoPricesStep = createStep(
  "rerate-auto-prices-step",
  async (_input: RerateAutoPricesInput, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const pricingService = container.resolve(Modules.PRICING) as any
    const fxService = container.resolve(FX_RATES_MODULE) as FxRatesService

    const output: RerateAutoPricesOutput = {
      scanned: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    }

    // 1. Pull every fx_price_meta row. The price↔fx_price_meta link
    //    is 1:1 so we can join to the price in the same query.
    const { data: metas } = await query.graph({
      entity: "fx_price_meta",
      fields: [
        "id",
        "base_currency",
        "base_amount",
        "fx_rate",
        "price.id",
        "price.amount",
        "price.currency_code",
        "price.price_set_id",
      ],
    })

    output.scanned = (metas ?? []).length
    if (!output.scanned) {
      return new StepResponse(output)
    }

    // 2. Compute fresh amounts. We do this in a first pass so we can
    //    bail per-row on FX errors without aborting the batch update.
    type Update = {
      fx_price_meta_id: string
      price_id: string
      price_set_id: string
      currency_code: string
      old_amount: number
      new_amount: number
      old_rate: number
      new_rate: number
    }
    const updates: Update[] = []

    for (const meta of (metas as any[]) ?? []) {
      const price = meta?.price
      if (!price?.id) {
        // Orphan meta — the underlying price was deleted but the
        // meta+link weren't cleaned up. Skip; a separate compaction
        // pass can prune these.
        output.skipped += 1
        continue
      }
      const base = String(meta.base_currency).toLowerCase()
      const target = String(price.currency_code).toLowerCase()
      const baseAmount = Number(meta.base_amount)

      try {
        const freshRate = await fxService.getRate(base, target)
        const newAmount = Math.round(baseAmount * freshRate * 100) / 100
        updates.push({
          fx_price_meta_id: meta.id,
          price_id: price.id,
          price_set_id: price.price_set_id,
          currency_code: target,
          old_amount: Number(price.amount),
          new_amount: newAmount,
          old_rate: Number(meta.fx_rate),
          new_rate: freshRate,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        output.errors.push({ fx_price_meta_id: meta.id, error: message })
        logger.warn(
          `[rerate] fx rate ${base} → ${target} for meta ${meta.id}: ${message}`
        )
      }
    }

    if (!updates.length) {
      return new StepResponse(output)
    }

    // 3. Apply price updates one price_set at a time. Medusa's
    //    `updatePriceSets` takes `{ id: price_set_id, prices: [...] }`
    //    where each price entry can have an `id` for upsert. Group by
    //    price_set_id so we issue one call per set.
    const bySet = new Map<string, Update[]>()
    for (const u of updates) {
      const list = bySet.get(u.price_set_id) ?? []
      list.push(u)
      bySet.set(u.price_set_id, list)
    }

    for (const [priceSetId, items] of bySet) {
      try {
        await pricingService.updatePriceSets(priceSetId, {
          prices: items.map((u) => ({
            id: u.price_id,
            currency_code: u.currency_code,
            amount: u.new_amount,
          })),
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        for (const u of items) {
          output.errors.push({ fx_price_meta_id: u.fx_price_meta_id, error: message })
        }
        logger.error(
          `[rerate] price_set ${priceSetId} update failed: ${message}`
        )
      }
    }

    // 4. Write fresh fx_rate values back to fx_price_meta so the next
    //    audit / tooltip lookup sees the same rate the price was
    //    computed at.
    const metaUpdates = updates.map((u) => ({
      id: u.fx_price_meta_id,
      fx_rate: u.new_rate,
    }))
    if (metaUpdates.length) {
      try {
        await fxService.updateFxPriceMetas(metaUpdates as any)
        output.updated = updates.length
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(
          `[rerate] fx_price_meta bulk update failed: ${message}`
        )
        // Don't push individual errors — the price updates succeeded;
        // only the meta's cached fx_rate is stale. Logged and move on.
      }
    }

    logger.info(
      `[rerate] scanned=${output.scanned} updated=${output.updated} ` +
        `skipped=${output.skipped} errors=${output.errors.length}`
    )
    return new StepResponse(output)
  }
)

export const rerateAutoConvertedPricesWorkflow = createWorkflow(
  "rerate-auto-converted-prices",
  (input: RerateAutoPricesInput) => {
    const summary = rerateAutoPricesStep(input)
    return new WorkflowResponse(summary)
  }
)

export default rerateAutoConvertedPricesWorkflow
