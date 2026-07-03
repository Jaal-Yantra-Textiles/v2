import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import fanoutPricesWorkflow from "../../../../workflows/fx/fanout-prices"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — replay FX fanout.
 *
 * Materialises the auto-converted price rows for existing partner variant
 * prices in every currency of the owning store's `supported_currencies`.
 * This is the guarded, UI-runnable version of
 * `src/scripts/fanout-existing-variant-prices.ts` — same enumeration
 * (partner → store → default sales channel → variants → price rows), same
 * idempotent `fanoutPricesWorkflow` per non-auto price.
 *
 * Why it's needed even though every write path now fans out inline: prices
 * created before that wiring landed (or before a store gained a new supported
 * currency via the region backfill) never got fanned out, so those products
 * read "not available" in non-native regions until this replay runs.
 *
 * Dry-run previews, per source price, exactly which currencies a fanout would
 * ADD — computed purely from the price_set's existing currencies vs the store's
 * supported currencies (no writes, no FX calls). Apply runs the workflow and
 * reports what it actually created.
 */

/** Hard cap on partners scanned in one call — bounds the per-request blast
 *  radius (each partner fans out every price on every store product). */
export const MAX_FX_FANOUT_PARTNER_SCAN = 5000

const fanoutFxParamsSchema = z.object({
  /** Restrict the replay to a single partner (default: all partners). */
  partner_id: z.string().min(1).optional(),
  /** Max partners to scan in one call (1..MAX_FX_FANOUT_PARTNER_SCAN). */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_FX_FANOUT_PARTNER_SCAN)
    .optional()
    .default(1000),
})

export type FanoutPriceRow = {
  id: string
  currency_code: string
  /** true when this row was itself created by a previous fanout (has fx meta). */
  is_auto: boolean
}

/**
 * PURE: for ONE source price, the target currencies a fanout would add.
 * Mirrors `fanoutPricesWorkflow`'s step logic exactly:
 *   - auto-derived source rows are skipped (recursion guard),
 *   - the source currency itself is skipped,
 *   - any currency already present on the price_set is skipped.
 * Case-insensitive; result is lowercased and de-duped, order preserved.
 */
export function previewFanoutCurrencies(args: {
  sourceCurrency: string
  isAutoConverted: boolean
  existingCurrencies: string[]
  supportedCurrencies: string[]
}): string[] {
  if (args.isAutoConverted) return []
  const source = String(args.sourceCurrency).toLowerCase()
  const existing = new Set(
    args.existingCurrencies.map((c) => String(c).toLowerCase())
  )
  const out: string[] = []
  for (const raw of args.supportedCurrencies) {
    const target = String(raw).toLowerCase()
    if (!target || target === source) continue
    if (existing.has(target)) continue
    if (out.includes(target)) continue
    out.push(target)
  }
  return out
}

/**
 * PURE: plan the fanout for a single price_set. Returns one entry per non-auto
 * source price that would gain at least one currency. Exported for unit tests.
 */
export function planPriceSetFanout(args: {
  priceSetId: string
  prices: FanoutPriceRow[]
  supportedCurrencies: string[]
}): Array<{ source_price_id: string; source_currency: string; add: string[] }> {
  const existingCurrencies = args.prices.map((p) => p.currency_code)
  const plan: Array<{ source_price_id: string; source_currency: string; add: string[] }> = []
  for (const price of args.prices) {
    const add = previewFanoutCurrencies({
      sourceCurrency: price.currency_code,
      isAutoConverted: price.is_auto,
      existingCurrencies,
      supportedCurrencies: args.supportedCurrencies,
    })
    if (add.length) {
      plan.push({ source_price_id: price.id, source_currency: price.currency_code, add })
    }
  }
  return plan
}

type StoreTarget = {
  partnerId: string
  partnerName: string
  storeId: string
  storeName: string
  supportedCurrencies: string[]
  channelId: string
}

/** Walk partners → stores → default sales channel, collecting the targets we
 *  can fan out. Stores without a default channel or supported currencies are
 *  skipped (nothing to fan out). */
async function collectStoreTargets(
  query: any,
  partnerId: string | undefined,
  limit: number
): Promise<{ targets: StoreTarget[]; skippedStores: number }> {
  const partnerGraphArgs: Record<string, unknown> = {
    entity: "partners",
    fields: [
      "id",
      "name",
      "stores.id",
      "stores.name",
      "stores.default_sales_channel_id",
      "stores.supported_currencies.currency_code",
    ],
    pagination: { take: limit },
  }
  if (partnerId) partnerGraphArgs.filters = { id: partnerId }

  const { data: partners } = await query.graph(partnerGraphArgs as any)

  const targets: StoreTarget[] = []
  let skippedStores = 0
  for (const partner of (partners ?? []) as any[]) {
    if (!partner?.id) continue
    for (const store of partner.stores ?? []) {
      const channelId = store?.default_sales_channel_id
      const supportedCurrencies = ((store?.supported_currencies ?? []) as any[])
        .map((c) => c?.currency_code)
        .filter(Boolean)
      if (!channelId || supportedCurrencies.length < 2) {
        // No channel → nothing priced through this store. <2 currencies →
        // nothing to convert TO. Either way there's nothing to fan out.
        skippedStores++
        continue
      }
      targets.push({
        partnerId: partner.id,
        partnerName: partner.name ?? partner.id,
        storeId: store.id,
        storeName: store.name ?? store.id,
        supportedCurrencies,
        channelId,
      })
    }
  }
  return { targets, skippedStores }
}

/** All variant price rows for a store's default sales channel, grouped by
 *  price_set. Uses the same sales_channel → products_link pivot the replay
 *  script documents (two-hop variant→sales_channel joins don't auto-resolve). */
async function collectStorePriceSets(
  query: any,
  channelId: string
): Promise<Array<{ priceSetId: string; prices: FanoutPriceRow[] }>> {
  const { data: scData } = await query.graph({
    entity: "sales_channel",
    filters: { id: channelId },
    fields: [
      "id",
      "products_link.product.variants.price_set.id",
      "products_link.product.variants.price_set.prices.id",
      "products_link.product.variants.price_set.prices.currency_code",
      "products_link.product.variants.price_set.prices.fx_price_meta.id",
    ],
  })

  const links = ((scData?.[0] as any)?.products_link ?? []) as Array<any>
  const byPriceSet = new Map<string, FanoutPriceRow[]>()
  for (const link of links) {
    for (const variant of link?.product?.variants ?? []) {
      const priceSet = variant?.price_set
      const priceSetId = priceSet?.id
      if (!priceSetId) continue
      const rows = byPriceSet.get(priceSetId) ?? []
      for (const price of priceSet?.prices ?? []) {
        if (!price?.id || !price?.currency_code) continue
        rows.push({
          id: String(price.id),
          currency_code: String(price.currency_code),
          is_auto: Boolean(price?.fx_price_meta?.id),
        })
      }
      byPriceSet.set(priceSetId, rows)
    }
  }
  return Array.from(byPriceSet.entries()).map(([priceSetId, prices]) => ({
    priceSetId,
    prices,
  }))
}

export const replayFxFanoutJob: MaintenanceJob = {
  id: "replay-fx-fanout",
  label: "Replay FX price fanout",
  description:
    `Materialise auto-converted variant prices in every currency of the owning store's supported_currencies, for products whose prices were created before FX fanout ran (or before the store gained the currency). Fixes products that read "not available" in non-native regions (e.g. an INR-priced product showing unavailable in the EUR region). Dry-run previews, per source price, exactly which currencies would be added — no writes, no FX calls. Apply runs the idempotent fanout workflow (skips currencies that already exist + auto-derived source rows). Optionally scope to one partner_id. Scans up to 'limit' partners per call (default 1000, max ${MAX_FX_FANOUT_PARTNER_SCAN}).`,
  params: [
    {
      name: "partner_id",
      type: "string",
      required: false,
      description: "Restrict the replay to a single partner (default: all partners)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max partners to scan in one call (default 1000, max ${MAX_FX_FANOUT_PARTNER_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = fanoutFxParamsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { partner_id, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

    const { targets, skippedStores } = await collectStoreTargets(
      query,
      partner_id,
      limit
    )

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let sourcesWithWork = 0
    let currenciesPlanned = 0
    let created = 0
    let storesScanned = 0

    for (const target of targets) {
      try {
        const priceSets = await collectStorePriceSets(query, target.channelId)
        storesScanned++

        for (const ps of priceSets) {
          const plan = planPriceSetFanout({
            priceSetId: ps.priceSetId,
            prices: ps.prices,
            supportedCurrencies: target.supportedCurrencies,
          })
          for (const item of plan) {
            sourcesWithWork++
            currenciesPlanned += item.add.length

            if (dry_run) {
              changes.push({
                entity: "price",
                id: item.source_price_id,
                field: "fanout_currencies",
                before: item.source_currency,
                after: item.add.join(", "),
              })
              continue
            }

            // Apply: run the idempotent fanout for this source price.
            try {
              const { result } = await fanoutPricesWorkflow(container).run({
                input: {
                  source_price_id: item.source_price_id,
                  store_id: target.storeId,
                },
              })
              const createdCount = result?.created_count ?? 0
              created += createdCount
              if (createdCount > 0) {
                changes.push({
                  entity: "price",
                  id: item.source_price_id,
                  field: "fanout_currencies",
                  before: item.source_currency,
                  after: String(createdCount),
                })
              }
              for (const e of result?.errors ?? []) {
                errors.push({
                  id: item.source_price_id,
                  message: `${e.currency}: ${e.error}`,
                })
              }
            } catch (err: any) {
              errors.push({
                id: item.source_price_id,
                message: err?.message ?? String(err),
              })
            }
          }
        }
      } catch (err: any) {
        errors.push({ id: target.storeId, message: err?.message ?? String(err) })
        logger.warn(
          `[replay-fx-fanout] store ${target.storeId} scan failed: ${err?.message ?? err}`
        )
      }
    }

    const summary = dry_run
      ? `Dry run — ${sourcesWithWork} source price(s) across ${storesScanned} store(s) would gain ${currenciesPlanned} auto-converted price(s)${
          skippedStores ? ` (${skippedStores} store(s) skipped: no channel / <2 currencies)` : ""
        }.`
      : `Fanned out ${created} auto-converted price(s) from ${sourcesWithWork} source price(s) across ${storesScanned} store(s)${
          errors.length ? `, ${errors.length} error(s)` : ""
        }.`

    return {
      job_id: replayFxFanoutJob.id,
      dry_run,
      applied: !dry_run && created > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default replayFxFanoutJob
