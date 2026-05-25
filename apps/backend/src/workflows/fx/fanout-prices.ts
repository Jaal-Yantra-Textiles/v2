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
 * Workflow: fanout-prices-from-source
 *
 * When a partner sets a manual price on a variant, this workflow
 * creates auto-converted price rows in the partner's other supported
 * currencies using FX rates from the fx_rates module.
 *
 * Algorithm:
 *   1. Resolve the source price → its price_set.
 *   2. Skip if the source itself is `metadata.is_auto_converted` —
 *      otherwise the subscriber would infinitely recurse on the
 *      auto-prices this workflow creates.
 *   3. Resolve the price_set → variant → product → first sales_channel
 *      → store. Single store assumption (one product belongs to one
 *      sales channel which belongs to one store). Skip if the chain
 *      breaks (orphan variants, products without a sales channel).
 *   4. Read store.supported_currencies — these are the currencies the
 *      partner is willing to display prices in.
 *   5. For each currency in supported_currencies that the price_set
 *      doesn't already have a row for, compute the converted amount
 *      via FX (cross-rate through the service's most-common-base
 *      logic), and create a new price row stamped with
 *      `metadata.is_auto_converted: true` + `base_currency` +
 *      `base_amount` so the daily re-rate (PR G5) can refresh it
 *      cleanly.
 *
 * Non-goals (deferred to other PRs):
 *   - Per-product base-currency override (G6+ if ever needed)
 *   - Re-rating already-auto-converted prices (G5's job)
 *   - Removing auto-prices when the source is deleted (track in PR
 *     G3 follow-up if it becomes a real problem)
 *
 * Failure semantics:
 *   Per-currency errors are logged + counted but never abort the
 *   whole fanout. A missing FX rate for one quote currency shouldn't
 *   stop the other 5. The workflow returns a summary the subscriber
 *   can log.
 */

export type FanoutPricesInput = {
  /** Source price id (the one the partner just set). */
  source_price_id: string
}

export type FanoutPricesOutput = {
  source_price_id: string
  skipped_reason?: string
  created_count: number
  skipped_currencies: string[]
  errors: Array<{ currency: string; error: string }>
}

const fanoutPricesStep = createStep(
  "fanout-prices-step",
  async (input: FanoutPricesInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const pricingService = container.resolve(Modules.PRICING) as any
    const fxService = container.resolve(FX_RATES_MODULE) as FxRatesService

    const output: FanoutPricesOutput = {
      source_price_id: input.source_price_id,
      created_count: 0,
      skipped_currencies: [],
      errors: [],
    }

    // 1. Resolve the source price + its price_set and existing siblings.
    const { data: prices } = await query.graph({
      entity: "price",
      filters: { id: input.source_price_id },
      fields: [
        "id",
        "amount",
        "currency_code",
        "price_set_id",
        "metadata",
      ],
    })
    const source = prices?.[0] as any
    if (!source) {
      output.skipped_reason = `source price ${input.source_price_id} not found`
      return new StepResponse(output)
    }

    if (source.metadata?.is_auto_converted) {
      // Guard against the subscriber → workflow → emit price.created
      // → subscriber recursion. Auto-converted prices never re-trigger
      // fanout.
      output.skipped_reason = "source is is_auto_converted"
      return new StepResponse(output)
    }

    // 2. Resolve price_set → variant → product → store via the
    //    Medusa-managed product_variant_price_set link.
    const { data: variantLinks } = await query.graph({
      entity: "product_variant_price_set",
      filters: { price_set_id: source.price_set_id },
      fields: [
        "variant_id",
        "variant.product.sales_channels.store_id",
      ],
    })
    const link = (variantLinks ?? [])[0] as any
    const storeId = link?.variant?.product?.sales_channels?.[0]?.store_id
    if (!storeId) {
      output.skipped_reason =
        "no store resolvable from price_set → variant → product → sales_channel"
      return new StepResponse(output)
    }

    // 3. Read the store's supported currencies.
    const storeService = container.resolve(Modules.STORE) as any
    const store: any = await storeService.retrieveStore(storeId, {
      relations: ["supported_currencies"],
    })
    const supportedCurrencies: Array<{
      currency_code: string
      is_default?: boolean
    }> = store?.supported_currencies ?? []
    if (!supportedCurrencies.length) {
      output.skipped_reason = "store has no supported_currencies"
      return new StepResponse(output)
    }

    // 4. Find which currencies in the price_set are already priced.
    const { data: existingPrices } = await query.graph({
      entity: "price",
      filters: { price_set_id: source.price_set_id },
      fields: ["id", "currency_code"],
    })
    const alreadyPriced = new Set(
      (existingPrices ?? []).map((p: any) =>
        String(p.currency_code).toLowerCase()
      )
    )

    const sourceCurrency = String(source.currency_code).toLowerCase()
    const sourceAmount = Number(source.amount)

    // 5. Fan out — one new price per supported currency that isn't
    //    already in the price_set.
    const newPrices: Array<{
      amount: number
      currency_code: string
      price_set_id: string
      metadata: Record<string, unknown>
    }> = []

    for (const sc of supportedCurrencies) {
      const target = String(sc.currency_code).toLowerCase()
      if (target === sourceCurrency) continue
      if (alreadyPriced.has(target)) {
        output.skipped_currencies.push(target)
        continue
      }

      try {
        const rate = await fxService.getRate(sourceCurrency, target)
        const convertedAmount = Math.round(sourceAmount * rate * 100) / 100
        newPrices.push({
          amount: convertedAmount,
          currency_code: target,
          price_set_id: source.price_set_id,
          metadata: {
            is_auto_converted: true,
            base_currency: sourceCurrency,
            base_amount: sourceAmount,
            fx_rate: rate,
            source_price_id: source.id,
          },
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        output.errors.push({ currency: target, error: message })
        logger.warn(
          `[fanout-prices] FX rate ${sourceCurrency} → ${target} failed: ${message}`
        )
      }
    }

    if (newPrices.length > 0) {
      // Use the pricing module's addPrices on the price_set rather
      // than createPrices alone — the latter requires the rules wiring
      // that addPrices handles for us.
      try {
        await pricingService.addPrices({
          priceSetId: source.price_set_id,
          prices: newPrices.map(({ price_set_id: _ps, ...p }) => p),
        })
        output.created_count = newPrices.length
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        for (const p of newPrices) {
          output.errors.push({ currency: p.currency_code, error: message })
        }
        logger.error(
          `[fanout-prices] bulk addPrices failed for price_set ${source.price_set_id}: ${message}`
        )
      }
    }

    return new StepResponse(output)
  }
)

export const fanoutPricesWorkflow = createWorkflow(
  "fanout-prices-from-source",
  (input: FanoutPricesInput) => {
    const summary = fanoutPricesStep(input)
    return new WorkflowResponse(summary)
  }
)

export default fanoutPricesWorkflow
