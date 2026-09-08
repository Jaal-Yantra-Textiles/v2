import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import priceFxMetaLink from "../../../../links/price-fx-meta"
import { FX_RATES_MODULE } from "../../../../modules/fx_rates"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #1857 — prune `fx_price_meta` markers whose Price no longer exists.
 *
 * THE MECHANISM (measured, not inferred)
 * --------------------------------------
 * `fx_price_meta` marks a Price as "created by FX fanout, safe to re-rate",
 * joined to the price by a 1:1 link. Nothing was wrong with how those rows are
 * WRITTEN — the fault is what happens to the price underneath them.
 *
 * `updateProductVariantsWorkflow` (every partner variant save, and the admin
 * variant route) does not patch prices in place: it **replaces the whole price
 * set**. Reproduced locally on `pset_01KX8REJ65…` — one `POST
 * /admin/products/:id/variants/:id` carrying a single `inr` price:
 *
 *   - all 11 fanout prices were HARD-deleted (0 soft-deleted, 0 surviving)
 *   - live link rows pointing at a missing price went 9 → 20 in that one request
 *   - all 20 markers survived
 *   - even the `inr` price I SENT came back with a new id
 *
 * So every variant price save orphans every FX marker on that variant, and the
 * fanout that runs immediately afterwards creates a fresh set beside them. The
 * tables grow by N rows per save, for ever. In prod this is the largest
 * dangling-link cluster in the #1857 audit: 215 of 610.
 *
 * WHY THIS IS A JANITOR AND NOT A BUG FIX
 * ---------------------------------------
 * 🔴 The one reader that walks these rows — `rerate-auto-converted-prices` —
 * already handles it correctly: it skips a marker whose price is gone and says
 * in a comment that "a separate compaction pass can prune these". That pass was
 * never written; this is it. Nothing is mispriced by the orphans. What they
 * cost is unbounded growth and a `scanned` count that is 35% noise.
 *
 * Fixing it at the producer would mean intercepting Medusa's own price-set
 * replacement, which owns those rows and gives us no event to hang off.
 *
 * WHAT IT DOES
 * ------------
 * Finds every live `fx_price_meta` whose linked Price is not visible, dismisses
 * the link and deletes the marker — the same order, and the same two calls, the
 * strip-on-edit route already uses when a partner overrides an auto price.
 * Dry-run (the default) lists them with the reason. Apply is idempotent.
 */

/** Hard cap on markers scanned in one call. */
export const MAX_META_SCAN = 20000

const paramsSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_META_SCAN)
    .optional()
    .default(MAX_META_SCAN),
})

/**
 * PURE: is this marker orphaned?
 *
 * 🔴 The test is whether `query.graph` can SEE the price, not whether a row
 * exists somewhere. A soft-deleted price resolves to the same absent join as a
 * hard-deleted one, and the first two sweeps of #1857 missed every soft-deleted
 * target by asking the other question — which is what took the prod count from
 * 27 pairs to 46. Exported for unit tests.
 */
export function isOrphanedFxMeta(meta: { price?: { id?: string } | null }): boolean {
  return !meta?.price?.id
}

export const compactFxPriceMetaJob: MaintenanceJob = {
  id: "compact-fx-price-meta",
  label: "Compact FX price markers whose price is gone",
  description:
    "Prune fx_price_meta rows (and their price↔meta link) left behind when the underlying Medusa Price was deleted. Every variant price save REPLACES the whole price set, so each save orphans all of that variant's FX markers while fanout creates a fresh set beside them — measured at 11 orphans from a single variant update locally, and 215 of 610 link rows in prod. Nothing is mispriced by them: the daily re-rate already skips a marker whose price is gone. This is the compaction pass that job's own comment asks for. Dry-run lists what would be pruned and why; apply dismisses the link then deletes the marker, in that order, and is idempotent.",
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max fx_price_meta rows to scan in one call (default & max ${MAX_META_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const link: any = container.resolve(ContainerRegistrationKeys.LINK)
    const fxService: any = container.resolve(FX_RATES_MODULE)

    /*
     * The same read the re-rate job makes, so the two agree about what an
     * orphan is by construction rather than by two similar-looking filters.
     */
    const { data: metas } = await query.graph({
      entity: "fx_price_meta",
      fields: [
        "id",
        "base_currency",
        "base_amount",
        "fx_rate",
        "source_price_id",
        "price.id",
      ],
      pagination: { take: limit },
    })

    const orphans = ((metas || []) as any[]).filter(isOrphanedFxMeta)

    /*
     * 🔴 The price id has to come from the LINK table, read through its
     * `entryPoint`.
     *
     * The obvious source is `meta.price.id` from the query above — and on an
     * orphan that is precisely the thing that is null. Without the link row
     * there is nothing to dismiss WITH: `link.dismiss` needs both sides, and a
     * dismiss with a wrong or missing price id silently removes nothing while
     * `deleteFxPriceMetas` succeeds, which would leave the link row behind
     * pointing at a marker that no longer exists either — a worse dangle than
     * the one being cleaned up.
     */
    const orphanIds = orphans.map((m) => String(m.id))
    const priceIdByMeta = new Map<string, string>()
    if (orphanIds.length) {
      const { data: linkRows } = await query.graph({
        entity: priceFxMetaLink.entryPoint,
        filters: { fx_price_meta_id: orphanIds },
        fields: ["price_id", "fx_price_meta_id"],
      })
      for (const row of (linkRows || []) as any[]) {
        if (row?.fx_price_meta_id && row?.price_id) {
          priceIdByMeta.set(String(row.fx_price_meta_id), String(row.price_id))
        }
      }
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    for (const meta of orphans) {
      const metaId = String(meta.id)
      const priceId = priceIdByMeta.get(metaId)

      changes.push({
        entity: "fx_price_meta",
        id: metaId,
        field: "price link",
        before: priceId ?? "(no live link row)",
        after: null,
        /*
         * 🔴 `note`, and NOT behind an `as MaintenanceChange`. My first draft
         * called this `reason` and cast the object to shut the compiler up —
         * which type-checked, and would have dropped the one field that makes
         * a dry-run arguable. A sweep that lists ids and nothing else can only
         * be checked by re-deriving it by hand.
         */
        note: priceId
          ? `price ${priceId} is not visible — the marker says this price was FX-created and it no longer exists (base ${meta.base_currency} ${meta.base_amount} @ ${meta.fx_rate})`
          : `no live link row for this marker — it marks nothing at all`,
      })

      if (dry_run) {
        continue
      }

      try {
        /*
         * Dismiss first, delete second — the order the strip-on-edit route
         * uses. Reversed, a failure between the two leaves a link row whose
         * BOTH ends are gone.
         */
        if (priceId) {
          await link.dismiss([
            {
              [Modules.PRICING]: { price_id: priceId },
              [FX_RATES_MODULE]: { fx_price_meta_id: metaId },
            },
          ])
        }
        await fxService.deleteFxPriceMetas(metaId)
      } catch (e: any) {
        errors.push({ id: metaId, message: e?.message ?? String(e) })
      }
    }

    const scanned = ((metas || []) as any[]).length
    const summary =
      changes.length === 0
        ? `No changes — scanned ${scanned} fx_price_meta row(s), every one still points at a live price`
        : `${dry_run ? "Would prune" : "Pruned"} ${changes.length} orphaned FX marker(s) of ${scanned} scanned (${Math.round((changes.length / Math.max(scanned, 1)) * 100)}% of the table marks a price that no longer exists)`

    return {
      job_id: compactFxPriceMetaJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0 && errors.length < changes.length,
      summary,
      changes,
      errors: errors.length ? errors : undefined,
    }
  },
}
