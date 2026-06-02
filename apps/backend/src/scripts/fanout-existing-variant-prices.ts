import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import fanoutPricesWorkflow from "../workflows/fx/fanout-prices"

/**
 * Replay the FX fanout workflow against every existing variant price
 * on partner stores so they materialize auto-converted rows in the
 * other currencies of `store.supported_currencies`.
 *
 * Why: `fanoutPricesWorkflow` runs synchronously when a partner saves
 * a variant (see `partners/stores/.../variants/batch`), but there's no
 * subscriber on `price.created` — so prices created before the FX
 * fanout shipped (or before the partner's store gained extra
 * supported_currencies via the link backfill) never got fanned out.
 * This script kicks the workflow once per existing manual price.
 *
 * Order of operations for the 0A unblock:
 *   1. `backfill-all-admin-regions-to-partners.ts` — link partners to
 *      every admin region so `partner_region` reflects the intended
 *      coverage.
 *   2. `backfill-store-currencies-from-partner-regions.ts` — extend
 *      `store.supported_currencies` to cover every linked region's
 *      currency.
 *   3. THIS script — replay fanout so existing variants gain prices in
 *      the newly-supported currencies.
 *
 * Idempotent: the workflow's `fx_price_meta` recursion guard skips
 * any price that was itself created by a previous fanout, and its
 * "already priced" check skips currencies that already exist on the
 * price_set. Safe to re-run.
 *
 * Run:
 *   npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts
 *
 * Dry run — counts targets, runs nothing:
 *   - Args:    npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts -- --dry-run
 *   - Env var: DRY_RUN=1 npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts
 *
 * Scope a subset of partners:
 *   npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts -- --partner-ids=par_a,par_b
 *   PARTNER_IDS=par_a,par_b npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts
 *
 * Cap concurrency for big tenants (default 4):
 *   CONCURRENCY=8 npx medusa exec ./src/scripts/fanout-existing-variant-prices.ts
 */
export default async function fanoutExistingVariantPrices({
  container,
  args,
}: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

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

  const partnerIdFilter = parseListArg("--partner-ids", "PARTNER_IDS")
  const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? "4"))

  if (dryRun) logger.info("DRY RUN — fanout workflow will not be invoked.")
  if (partnerIdFilter?.length) {
    logger.info(`Partner scope: ${partnerIdFilter.join(", ")}`)
  }

  // 1. Partners → stores → default_sales_channel_id. We walk via the
  //    store's default channel because that's the channel partner-ui
  //    creates products against; products outside that channel
  //    wouldn't be priced through this store anyway.
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: [
      "id",
      "name",
      "stores.id",
      "stores.name",
      "stores.default_sales_channel_id",
    ],
  })

  const targetPartners = (partners ?? []).filter(
    (p: any) => !partnerIdFilter || partnerIdFilter.includes(p.id)
  )

  if (!targetPartners.length) {
    logger.warn(
      partnerIdFilter
        ? `No partners matched the --partner-ids filter: ${partnerIdFilter.join(", ")}`
        : "No partners found. Nothing to fanout."
    )
    return
  }

  type Target = { partnerId: string; storeId: string; priceId: string }
  const targets: Target[] = []
  let partnersWithoutChannel = 0
  let variantsScanned = 0
  let pricesScanned = 0

  for (const partner of targetPartners as any[]) {
    for (const store of partner.stores ?? []) {
      const channelId = store?.default_sales_channel_id
      if (!channelId) {
        partnersWithoutChannel++
        logger.info(
          `partner "${partner.name}" (${partner.id}), store "${store?.name}" (${store?.id}): no default_sales_channel_id — skipping`
        )
        continue
      }

      // 2. All variants whose product lives in the store's default
      //    sales channel. price_set.prices is what we need for fanout
      //    inputs.
      const { data: variants } = await query.graph({
        entity: "product_variants",
        filters: { "product.sales_channels.id": channelId } as any,
        fields: [
          "id",
          "product.id",
          "price_set.prices.id",
        ],
      })

      let storeVariants = 0
      let storePrices = 0
      for (const variant of (variants ?? []) as any[]) {
        storeVariants++
        const prices = variant?.price_set?.prices ?? []
        for (const price of prices) {
          if (!price?.id) continue
          storePrices++
          targets.push({
            partnerId: partner.id,
            storeId: store.id,
            priceId: price.id,
          })
        }
      }
      variantsScanned += storeVariants
      pricesScanned += storePrices
      logger.info(
        `partner "${partner.name}" (${partner.id}), store "${store.name}" (${store.id}): ${storeVariants} variants, ${storePrices} price rows`
      )
    }
  }

  logger.info(
    `Scanned ${targetPartners.length} partner(s), ${variantsScanned} variant(s), ${pricesScanned} price row(s). Targeting ${targets.length} fanout invocation(s)${
      partnersWithoutChannel
        ? ` (${partnersWithoutChannel} store(s) skipped: no default channel)`
        : ""
    }.`
  )

  if (dryRun || !targets.length) {
    logger.info(
      `Done${dryRun ? " (DRY RUN)" : ""}. ${targets.length} fanout invocations would have run.`
    )
    return
  }

  // 3. Run the workflow with bounded concurrency. The workflow itself
  //    short-circuits on its recursion guard for auto-derived prices,
  //    so we don't need to filter those out up-front — the count of
  //    "skipped because auto-derived" is what the workflow returns in
  //    `skipped_reason`, and the operator gets a useful tally.
  let created = 0
  let skippedAuto = 0
  let skippedOther = 0
  let errored = 0
  const errors: Array<{ priceId: string; storeId: string; error: string }> = []

  const queue = [...targets]
  const runOne = async () => {
    while (queue.length) {
      const t = queue.shift()
      if (!t) break
      try {
        const { result } = await fanoutPricesWorkflow(container).run({
          input: { source_price_id: t.priceId, store_id: t.storeId },
        })
        if (result?.skipped_reason) {
          if (result.skipped_reason.includes("auto-converted")) {
            skippedAuto++
          } else {
            skippedOther++
            logger.info(
              `[fanout] price ${t.priceId}: skipped — ${result.skipped_reason}`
            )
          }
        }
        if (result?.created_count) {
          created += result.created_count
          logger.info(
            `[fanout] price ${t.priceId}: created ${result.created_count} auto-prices`
          )
        }
        if (result?.errors?.length) {
          for (const e of result.errors) {
            errored++
            errors.push({
              priceId: t.priceId,
              storeId: t.storeId,
              error: `${e.currency}: ${e.error}`,
            })
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errored++
        errors.push({ priceId: t.priceId, storeId: t.storeId, error: message })
        logger.warn(`[fanout] price ${t.priceId}: workflow failed — ${message}`)
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, runOne)
  )

  logger.info(
    `Fanout complete. created_prices=${created}, skipped_auto=${skippedAuto}, skipped_other=${skippedOther}, errors=${errored}, total_invocations=${targets.length}`
  )

  if (errors.length) {
    logger.error("Errors during fanout — review the log above:")
    for (const e of errors.slice(0, 50)) {
      logger.error(
        `  price=${e.priceId} store=${e.storeId}: ${e.error}`
      )
    }
    if (errors.length > 50) {
      logger.error(`  (… ${errors.length - 50} more)`)
    }
    process.exitCode = 1
  }
}
