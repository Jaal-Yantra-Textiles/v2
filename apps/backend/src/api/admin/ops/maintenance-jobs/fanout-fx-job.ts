import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { requestVariantPriceFanout } from "../../../../workflows/fx/fanout-variant-prices"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #457 Data Plumbing — replay FX fanout.
 *
 * Materialises the auto-converted price rows for existing partner variant
 * prices in every currency of the owning store's `supported_currencies`.
 * This is the guarded, UI-runnable version of
 * `src/scripts/fanout-existing-variant-prices.ts` — same enumeration
 * (partner → store → default sales channel → variants → price rows), same
 * idempotent fanout per non-auto price. It differs from the script in WHERE
 * the fanout runs: the script is a CLI process that can block as long as it
 * likes, this job is an HTTP request and so hands the work to the worker
 * instead (see below).
 *
 * Why it's needed even though every write path now fans out inline: prices
 * created before that wiring landed (or before a store gained a new supported
 * currency via the region backfill) never got fanned out, so those products
 * read "not available" in non-native regions until this replay runs.
 *
 * Dry-run previews, per source price, exactly which currencies a fanout would
 * ADD — computed purely from the price_set's existing currencies vs the store's
 * supported currencies (no writes, no FX calls).
 *
 * ⚠️ APPLY QUEUES, IT DOES NOT FAN OUT (#1996).
 *
 * This job used to call `fanoutPricesWorkflow` once per source price, inline,
 * on the HTTP request path. Two consequences, both observed:
 *
 *  1. It timed out. Opening the 7 new sales regions on 2026-09-11 needed 1,331
 *     price rows; five successive applies all returned "The operation timed
 *     out" **while succeeding server-side** (264 → 202 → … → 0 remaining). A
 *     timeout is indistinguishable from a failure, so the only way to learn
 *     the true state was to re-run the preview and watch the count fall.
 *  2. It was the last caller still doing the thing that OOM-killed prod twice
 *     on 2026-08-19 (exit 137). Every other write path emits
 *     FX_FANOUT_REQUESTED so the work lands on the WORKER; this one did not.
 *     It survived only because the load happened to be split across five
 *     timed-out calls instead of arriving as one.
 *
 * So apply now emits FX_FANOUT_REQUESTED in bounded batches and returns
 * immediately. `applied: true` therefore means QUEUED, not done — which the
 * summary says in words, because a weaker guarantee that is only implied is
 * how "a check that never ran reads as a pass" happens.
 *
 * Confirmation is the preview: re-run with dry_run and it reports 0 source
 * prices when the worker has finished.
 */

/** Hard cap on partners scanned in one call — bounds the per-request blast
 *  radius (each partner fans out every price on every store product). */
export const MAX_FX_FANOUT_PARTNER_SCAN = 5000

/**
 * Source price ids per FX_FANOUT_REQUESTED event.
 *
 * This is the job's half of a two-part ceiling, and neither half is optional:
 *
 *   - HERE: a batch bounds the size of one event payload and one unit of
 *     redelivery. A single event carrying all 1,331 prices would make the
 *     retry granularity "everything", which is how a partial failure becomes a
 *     full replay.
 *   - IN THE SUBSCRIBER: `FANOUT_MAX_CONCURRENCY` (4) bounds how many
 *     workflow runs are actually in flight. THAT is the memory ceiling; the
 *     batch size is not, because a batch is processed with that concurrency,
 *     not all at once.
 *
 * Emission itself is sequential — one awaited `emit` at a time — so this job
 * never has more than one bus call outstanding either. The 2026-08-19 kill
 * came from a docblock that CLAIMED bounded concurrency (`Promise.allSettled`,
 * which bounds nothing); `replay-fx-fanout.unit.spec.ts` exercises the batch
 * ceiling rather than trusting this comment.
 */
export const FX_FANOUT_JOB_BATCH_SIZE = 50

/**
 * PURE: split ids into batches of at most `size`, preserving order.
 * Exported so the ceiling is testable without an event bus.
 */
export function chunkPriceIds(ids: string[], size = FX_FANOUT_JOB_BATCH_SIZE): string[][] {
  const bounded = Math.max(1, Math.floor(size))
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += bounded) out.push(ids.slice(i, i + bounded))
  return out
}

const fanoutFxParamsSchema = z.object({
  /** Restrict the replay to a single partner (default: all partners). */
  partner_id: z.string().min(1).optional(),
  /**
   * WINDOW SIZE, not "the next N to do".
   *
   * ⚠️ `limit` bounds PARTNERS and, on its own, always takes the FIRST N in a
   * stable id order. Once those partners are clean it reports "0 changes"
   * forever while later partners are still outstanding — which reads exactly
   * like completion. Page with `offset` if you scope a long run this way.
   */
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_FX_FANOUT_PARTNER_SCAN)
    .optional()
    .default(1000),
  /** Partners to skip before the window starts — makes `limit` a real cursor. */
  offset: z.number().int().min(0).optional().default(0),
  /**
   * Also replay the HOUSE store(s) — the ones no partner owns. On by default:
   * omitting them is what left admin-side products (custom-design products in
   * particular) priced in a single currency with nothing to fix them. Ignored
   * when `partner_id` is given, which is an explicit request for one partner.
   */
  include_house_stores: z.boolean().optional().default(true),
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
  /** null for a house store — one no partner owns. */
  partnerId: string | null
  partnerName: string
  storeId: string
  storeName: string
  supportedCurrencies: string[]
  channelId: string
}

/** Walk partners → stores → default sales channel, collecting the targets we
 *  can fan out. Stores without a default channel or supported currencies are
 *  skipped (nothing to fan out). */
export async function collectStoreTargets(
  query: any,
  partnerId: string | undefined,
  limit: number,
  offset = 0
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
    // `order` is what makes `offset` mean anything: without a deterministic
    // sort, page 2 is not "the partners after page 1" — it is an arbitrary
    // window that may repeat or skip rows between calls.
    pagination: { take: limit, skip: offset, order: { id: "ASC" } },
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

/**
 * Stores NO partner owns — the house/admin store(s).
 *
 * Why this exists: `collectStoreTargets` walks `partners → stores`, so a store
 * with no partner is unreachable by it, and every product on that store's
 * channel is invisible to the replay. That is not a corner case — admin-side
 * custom-design products live on the house channel, and the route that writes
 * their prices (core's `/admin/products/:id/variants/batch`) does not fan out
 * inline either. So those prices were written in one currency AND had no repair
 * path. Four of them were found that way (#1900).
 *
 * Ownership rule is copied from `delete-orphan-store-job` — all stores minus
 * the ones reachable through a partner — so "house" means the same thing in
 * both jobs rather than two drifting definitions.
 */
export async function collectHouseStoreTargets(
  query: any
): Promise<{ targets: StoreTarget[]; skippedStores: number }> {
  const { data: stores } = await query.graph({
    entity: "stores",
    fields: [
      "id",
      "name",
      "default_sales_channel_id",
      "supported_currencies.currency_code",
    ],
  })

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.id"],
  })
  const partnerOwned = new Set<string>()
  for (const p of (partners ?? []) as any[]) {
    for (const st of (p?.stores ?? []) as any[]) {
      if (st?.id) partnerOwned.add(String(st.id))
    }
  }

  const targets: StoreTarget[] = []
  let skippedStores = 0
  for (const store of (stores ?? []) as any[]) {
    if (!store?.id || partnerOwned.has(String(store.id))) continue
    const channelId = store?.default_sales_channel_id
    const supportedCurrencies = ((store?.supported_currencies ?? []) as any[])
      .map((c) => c?.currency_code)
      .filter(Boolean)
    // Same two skips as the partner walk: no channel means nothing is priced
    // through this store, <2 currencies means there is nothing to convert TO.
    if (!channelId || supportedCurrencies.length < 2) {
      skippedStores++
      continue
    }
    targets.push({
      partnerId: null,
      partnerName: "House (no partner)",
      storeId: String(store.id),
      storeName: store.name ?? String(store.id),
      supportedCurrencies,
      channelId,
    })
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
    `Materialise auto-converted variant prices in every currency of the owning store's supported_currencies, for products whose prices were created before FX fanout ran (or before the store gained the currency). Fixes products that read "not available" in non-native regions (e.g. an INR-priced product showing unavailable in the EUR region). Dry-run previews, per source price, exactly which currencies would be added — no writes, no FX calls. APPLY QUEUES THE WORK AND RETURNS: it emits fx.fanout_requested in batches of up to ${FX_FANOUT_JOB_BATCH_SIZE} so the idempotent fanout runs on the WORKER, so 'applied' here means QUEUED, not done — re-run the dry run to confirm completion (it reports 0 source prices when the worker has finished). It used to run every fanout inline on the request path, which timed out on large replays while still succeeding server-side, and was the last caller doing the thing that OOM-killed prod on 2026-08-19. Covers partner stores AND the house store(s) — the ones no partner owns, where admin-side custom-design products live; those were previously unreachable by this job, so prices written there had no repair path at all. Optionally scope to one partner_id (which excludes house stores). Scans up to 'limit' partners per call (default 1000, max ${MAX_FX_FANOUT_PARTNER_SCAN}).`,
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
      description: `WINDOW size over partners, not "the next N to do" (default 1000, max ${MAX_FX_FANOUT_PARTNER_SCAN}). On its own it always takes the FIRST N in id order, so once those are clean it reports 0 changes forever while later partners are still outstanding. Page with offset.`,
    },
    {
      name: "offset",
      type: "number",
      required: false,
      description:
        "Partners to skip before the window starts (default 0) — this is what makes 'limit' a real cursor rather than a repeat of page one.",
    },
    {
      name: "include_house_stores",
      type: "boolean",
      required: false,
      description:
        "Also replay the house store(s) — the ones no partner owns, where admin-side custom-design products live. Default true. Ignored when partner_id is set.",
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
    const { partner_id, limit, offset, include_house_stores } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

    const partnerScan = await collectStoreTargets(query, partner_id, limit, offset)

    // `partner_id` is an explicit request for ONE partner, so house stores are
    // not silently added to it. Otherwise they are part of "replay everything".
    const houseScan =
      !partner_id && include_house_stores
        ? await collectHouseStoreTargets(query)
        : { targets: [] as StoreTarget[], skippedStores: 0 }

    const targets = [...partnerScan.targets, ...houseScan.targets]
    const skippedStores = partnerScan.skippedStores + houseScan.skippedStores
    const houseStoresScanned = houseScan.targets.length

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let sourcesWithWork = 0
    let currenciesPlanned = 0
    let queued = 0
    let batchesEmitted = 0
    let storesScanned = 0

    for (const target of targets) {
      try {
        const priceSets = await collectStorePriceSets(query, target.channelId)
        storesScanned++

        // Source prices this store would hand to the worker. Collected per
        // store because FX_FANOUT_REQUESTED is keyed on store_id — the store's
        // supported_currencies are what the fanout converts INTO.
        const storePriceIds: string[] = []

        for (const ps of priceSets) {
          const plan = planPriceSetFanout({
            priceSetId: ps.priceSetId,
            prices: ps.prices,
            supportedCurrencies: target.supportedCurrencies,
          })
          for (const item of plan) {
            sourcesWithWork++
            currenciesPlanned += item.add.length

            // The change set is identical in both modes on purpose: apply
            // reports exactly what it HANDED OVER, in the same shape the
            // preview said it would. Nothing here claims the fanout ran.
            changes.push({
              entity: "price",
              id: item.source_price_id,
              field: "fanout_currencies",
              before: item.source_currency,
              after: item.add.join(", "),
              note: dry_run
                ? `store ${target.storeId} — would queue`
                : `store ${target.storeId} — queued for the worker, not yet fanned out`,
            })

            if (!dry_run) storePriceIds.push(item.source_price_id)
          }
        }

        // Apply: hand the work to the worker in bounded batches, one awaited
        // emit at a time. Nothing is fanned out on this request path (#1996).
        for (const batch of chunkPriceIds(storePriceIds)) {
          const outcome = await requestVariantPriceFanout(container, {
            storeId: target.storeId,
            priceIds: batch,
          })
          if (outcome.queued) {
            batchesEmitted++
            queued += batch.length
          } else {
            // The emit never throws, so a dead bus would otherwise be
            // reported as a successful queue of everything.
            errors.push({
              id: target.storeId,
              message: `could not queue ${batch.length} price(s): ${outcome.reason ?? "unknown"}`,
            })
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
      ? `Dry run — ${sourcesWithWork} source price(s) across ${storesScanned} store(s)${
          houseStoresScanned ? ` (incl. ${houseStoresScanned} house)` : ""
        } would gain ${currenciesPlanned} auto-converted price(s)${
          skippedStores ? ` (${skippedStores} store(s) skipped: no channel / <2 currencies)` : ""
        }.`
      : `QUEUED — not yet fanned out. ${queued} source price(s) across ${storesScanned} store(s)${
          houseStoresScanned ? ` (incl. ${houseStoresScanned} house)` : ""
        } handed to the worker in ${batchesEmitted} batch(es) of up to ${FX_FANOUT_JOB_BATCH_SIZE}; they will gain up to ${currenciesPlanned} auto-converted price(s). This job does NOT wait for the fanout — re-run it with dry_run to confirm, it reports 0 source prices when the worker is done${
          errors.length ? `. ${errors.length} batch/store error(s)` : ""
        }.`

    return {
      job_id: replayFxFanoutJob.id,
      dry_run,
      // ⚠️ WEAKER THAN IT LOOKS: `applied` means the fanout was QUEUED, not
      // performed. The summary says so in words rather than leaving it to be
      // inferred from this flag.
      applied: !dry_run && queued > 0,
      summary,
      changes,
      errors,
    }
  },
}

export default replayFxFanoutJob
