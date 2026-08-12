import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import {
  countComparableLevels,
  findLevelValueDivergence,
  planNegativeLevelResets,
} from "../api/admin/ops/maintenance-jobs/reset-negative-inventory-levels-job"

/**
 * Inventory level divergence watcher (#1259).
 *
 * `model.bigNumber()` persists a value TWICE — `<field> numeric` and
 * `raw_<field> jsonb`. On 2026-08-11 a level was found where the two halves had
 * drifted apart: `FAB-TWO-BLU-001` read 0 through one API and -2.5 through
 * another, and the negative sweep reported "no negative levels across 194"
 * while an operator was looking at -2.5 on screen.
 *
 * The detector for that already exists, in the `reset-negative-inventory-levels`
 * maintenance job. Its problem is not accuracy — it is that **nothing runs it**.
 * It fires only when a human types the job name, which is why a level created
 * 2026-03-26 was not noticed until 2026-08-11, and why the forensic trail
 * (workflow-execution history, the level's pre-correction `updated_at`) had
 * already aged out by the time anyone looked. The cause of that first
 * divergence is now unrecoverable. The cost of the NEXT one is a scheduling
 * decision, and this is it.
 *
 * This job is READ-ONLY, deliberately. It resolves nothing:
 *
 * - **Divergence is never auto-resolved.** Neither column is inherently
 *   authoritative — the numeric side is what most queries filter on, the raw
 *   side is what the admin UI renders — so picking a winner is a judgement
 *   about what really happened to the stock, and that belongs to a human. Same
 *   reasoning as refusing to guess a null `quantity_basis` (#1248).
 * - **Negatives are not zeroed either.** A negative can be the residue of a
 *   movement recorded with no counterpart, or it can be an un-recorded receipt
 *   — and zeroing the second erases the evidence. `reset-negative-inventory-levels`
 *   exists for that, behind a dry-run, on purpose.
 *
 * So this only ever says "look at this", and it says it the day it happens
 * instead of four months later.
 *
 * ⚠️ The denominator is logged on EVERY run, healthy or not. The detector skips
 * any row that did not return a readable `raw_stocked_quantity`, so a detector
 * reading zero rows and a detector finding nothing wrong print IDENTICAL
 * output. `compared 194/194` is evidence; `compared 0/194` is visibly useless.
 * That distinction is the whole point of #1260 and it must survive here too.
 */

export default async function checkInventoryLevelDivergence(
  container: MedusaContainer
) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: [
        "id",
        "inventory_item_id",
        "location_id",
        "stocked_quantity",
        // The other half of the bigNumber pair. Without it this watcher reads
        // one side of the row and is confidently wrong when they disagree —
        // which is the exact failure it exists to catch.
        "raw_stocked_quantity",
      ],
    })

    const rows = (levels || []) as any[]
    const divergent = findLevelValueDivergence(rows)
    const negatives = planNegativeLevelResets(rows)
    const coverage = countComparableLevels(rows)

    const coverageLine =
      coverage.compared === coverage.total
        ? `compared ${coverage.compared}/${coverage.total} level(s)`
        : `⚠️ compared only ${coverage.compared}/${coverage.total} level(s) — the rest returned no readable raw_stocked_quantity${
            coverage.compared === 0
              ? ", so this check is INERT and a clean result here means nothing"
              : ""
          }`

    // A partial denominator is itself a finding: it means the check silently
    // stopped looking. Say so loudly even when nothing else is wrong.
    if (coverage.compared !== coverage.total) {
      logger.warn(`[inventory-divergence] ${coverageLine}`)
    }

    if (!divergent.length && !negatives.length) {
      logger.info(
        `[inventory-divergence] Clean — no divergence, no negative levels (${coverageLine}).`
      )
      return
    }

    const parts: string[] = []

    if (divergent.length) {
      parts.push(
        `${divergent.length} level(s) whose two stored values DISAGREE: ${divergent
          .map(
            (d) =>
              `${d.sku || d.inventory_item_id}@${d.location_id} numeric=${
                d.numeric
              } raw=${d.raw}`
          )
          .join(", ")}`
      )
    }

    if (negatives.length) {
      parts.push(
        `${negatives.length} negative level(s): ${negatives
          .map(
            (n) => `${n.sku || n.inventory_item_id}@${n.location_id} at ${n.before}`
          )
          .join(", ")}`
      )
    }

    const title = divergent.length
      ? `Inventory levels disagree with themselves (${divergent.length})`
      : `Negative inventory level${negatives.length === 1 ? "" : "s"} (${
          negatives.length
        })`

    const description =
      `${parts.join(". ")}. ${coverageLine}. ` +
      `Nothing was changed — decide what really happened to the stock first. ` +
      `Divergence: write the true value with POST /admin/inventory-items/:id/location-levels/:location_id, which rewrites both halves. ` +
      `Negatives: run the reset-negative-inventory-levels maintenance job dry-run, and if the negative is an un-recorded receipt, record the receipt instead of zeroing it.`

    logger.warn(`[inventory-divergence] ${title} — ${description}`)

    // Best-effort: a notification-provider outage must not fail the job, or a
    // transient problem would also cost us the log line above.
    try {
      const notificationService: any = container.resolve(Modules.NOTIFICATION)
      await notificationService.createNotifications({
        to: "",
        channel: "feed",
        template: "admin-ui",
        data: { title, description },
      })
    } catch (e: any) {
      logger.warn(
        `[inventory-divergence] Could not post the admin notification: ${e?.message}`
      )
    }
  } catch (e: any) {
    logger.error(`[inventory-divergence] Error: ${e?.message}`)
  }
}

export const config = {
  name: "check-inventory-level-divergence",
  // Daily, 05:00 UTC — early enough that a divergence found overnight is on the
  // bell before the working day, and cheap: one query.graph over every level.
  schedule: "0 5 * * *",
}
