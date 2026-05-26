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
 *   1. Resolve the source price.
 *   2. Recursion guard: query for the link
 *      `price ↔ fx_price_meta`. If the source already has an
 *      `fx_price_meta` row, fanout was the thing that created it —
 *      skip, otherwise the price.created event would trigger an
 *      infinite re-emit loop.
 *   3. Resolve price_set → variant → product → first sales_channel
 *      → store. Skip if the chain breaks.
 *   4. Read store.supported_currencies — these are the currencies
 *      the partner is willing to display prices in.
 *   5. For each currency in supported_currencies that the price_set
 *      doesn't already have a row for, compute the converted amount
 *      via FX and call `addPrices` to attach a new price row to the
 *      price_set.
 *   6. For each newly created price, create an `fx_price_meta` row
 *      (base_currency, base_amount, fx_rate, source_price_id) and
 *      a Medusa link between `price.id` and `fx_price_meta.id`. The
 *      link is the discriminator the recursion guard, UI badge,
 *      strip-on-edit, and daily re-rate all read.
 *
 * Why a separate fx_price_meta table:
 *   Medusa's `Price` model has no `metadata` column (verified). An
 *   earlier draft tried to stash the FX audit fields in `metadata`
 *   and it silently dropped — discovered when the recursion guard
 *   never fired. See apps/docs/notes/FX_AUTO_CONVERSION.md.
 *
 * Failure semantics:
 *   Per-currency errors during rate lookup are logged + counted but
 *   never abort the whole fanout. If `addPrices` itself fails the
 *   step throws so the workflow reports failure to the subscriber.
 */

export type FanoutPricesInput = {
  /** Source price id (the one the partner just set). */
  source_price_id: string
  /**
   * Optional: the store whose supported_currencies drive the fanout.
   * Pass this from contexts where you already know the store (partner
   * routes, scripts). When omitted, the workflow derives it by walking
   * price_set → variant → product → sales_channel and looking up the
   * store where `default_sales_channel_id` matches — useful as a
   * fallback but slower and dependent on the product being linked to
   * a sales_channel that's the default for exactly one store.
   */
  store_id?: string
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
    const link = container.resolve(ContainerRegistrationKeys.LINK)
    const pricingService = container.resolve(Modules.PRICING) as any
    const fxService = container.resolve(FX_RATES_MODULE) as FxRatesService

    const output: FanoutPricesOutput = {
      source_price_id: input.source_price_id,
      created_count: 0,
      skipped_currencies: [],
      errors: [],
    }

    // 1. Load source price + its fx_price_meta link (which doubles as
    //    the recursion guard).
    const { data: prices } = await query.graph({
      entity: "price",
      filters: { id: input.source_price_id },
      fields: [
        "id",
        "amount",
        "currency_code",
        "price_set_id",
        "fx_price_meta.id",
      ],
    })
    const source = prices?.[0] as any
    if (!source) {
      output.skipped_reason = `source price ${input.source_price_id} not found`
      return new StepResponse(output)
    }

    if (source.fx_price_meta?.id) {
      // The source price was itself created by a previous fanout (it
      // has an fx_price_meta row + link). Without this guard the
      // subscriber → workflow → addPrices → price.created loop would
      // recurse forever.
      output.skipped_reason = "source is auto-converted (fx_price_meta exists)"
      return new StepResponse(output)
    }

    // 2. Resolve the store. If the caller passed `store_id`, trust it
    //    (partner routes always know their store and this is the fast
    //    path). Otherwise fall back to deriving via the product's
    //    sales_channels → the store whose default_sales_channel_id
    //    matches. Note: sales_channel ↔ store is NOT a Medusa link —
    //    store.default_sales_channel_id is a plain column, so this
    //    requires a separate query.
    let storeId = input.store_id
    if (!storeId) {
      const { data: variantLinks } = await query.graph({
        entity: "product_variant_price_set",
        filters: { price_set_id: source.price_set_id },
        fields: ["variant.product.sales_channels.id"],
      })
      const channelIds = ((variantLinks ?? []) as any[])
        .flatMap((vl) => vl?.variant?.product?.sales_channels ?? [])
        .map((sc: any) => sc?.id)
        .filter(Boolean)
      if (channelIds.length) {
        const { data: stores } = await query.graph({
          entity: "stores",
          filters: { default_sales_channel_id: channelIds },
          fields: ["id"],
        })
        storeId = (stores ?? [])[0]?.id
      }
      if (!storeId) {
        output.skipped_reason =
          "no store resolvable from price_set → variant → product → sales_channel → store"
        return new StepResponse(output)
      }
    }

    // 3. Read store + opt-out flag + supported currencies.
    const storeService = container.resolve(Modules.STORE) as any
    const store: any = await storeService.retrieveStore(storeId, {
      relations: ["supported_currencies"],
    })

    // Partner-controlled toggle (default ON). When false, partner
    // has opted out of cross-currency fanout for this store.
    if (store?.metadata?.fx_auto_convert === false) {
      output.skipped_reason = "store has fx_auto_convert disabled"
      return new StepResponse(output)
    }

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

    // 5. For each missing currency, compute converted amount.
    const newPrices: Array<{
      amount: number
      currency_code: string
      fx_rate: number
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
          fx_rate: rate,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        output.errors.push({ currency: target, error: message })
        logger.warn(
          `[fanout-prices] FX rate ${sourceCurrency} → ${target} failed: ${message}`
        )
      }
    }

    if (newPrices.length === 0) {
      return new StepResponse(output)
    }

    // 6. Bulk-create the price rows on the price_set. addPrices
    //    returns the updated PriceSet with its full prices array; we
    //    locate the rows we just added by currency_code (none can
    //    collide since we filtered out already-priced currencies
    //    above).
    let returnedPriceSet: any
    try {
      returnedPriceSet = await pricingService.addPrices({
        priceSetId: source.price_set_id,
        prices: newPrices.map((p) => ({
          amount: p.amount,
          currency_code: p.currency_code,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      for (const p of newPrices) {
        output.errors.push({ currency: p.currency_code, error: message })
      }
      logger.error(
        `[fanout-prices] bulk addPrices failed for price_set ${source.price_set_id}: ${message}`
      )
      return new StepResponse(output)
    }

    const createdPrices: Array<{ id: string; currency_code: string }> = (
      returnedPriceSet?.prices ?? []
    ).filter((p: any) => {
      const c = String(p.currency_code).toLowerCase()
      return newPrices.some((np) => np.currency_code === c)
    })

    // 7. Write FxPriceMeta rows + Medusa links. One row + one link
    //    per newly created price.
    const metasToCreate = createdPrices
      .map((p) => {
        const match = newPrices.find(
          (np) => np.currency_code === String(p.currency_code).toLowerCase()
        )
        if (!match) return null
        return {
          price_id: p.id,
          base_currency: sourceCurrency,
          base_amount: sourceAmount,
          fx_rate: match.fx_rate,
          source_price_id: source.id,
        }
      })
      .filter(Boolean) as Array<{
      price_id: string
      base_currency: string
      base_amount: number
      fx_rate: number
      source_price_id: string
    }>

    if (metasToCreate.length) {
      const created = await fxService.createFxPriceMetas(
        metasToCreate.map(({ price_id: _omit, ...rest }) => rest)
      )
      // createFxPriceMetas returns the created rows in input order,
      // so we can zip them back to their target price ids.
      const linksToCreate = metasToCreate.map((m, i) => ({
        [Modules.PRICING]: { price_id: m.price_id },
        [FX_RATES_MODULE]: { fx_price_meta_id: created[i].id },
      }))
      await link.create(linksToCreate)
    }

    output.created_count = createdPrices.length
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
