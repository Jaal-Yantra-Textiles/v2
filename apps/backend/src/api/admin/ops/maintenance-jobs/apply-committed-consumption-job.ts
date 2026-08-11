import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import type { MedusaContainer } from "@medusajs/framework/types"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

import { CONSUMPTION_LOG_MODULE } from "../../../../modules/consumption_log"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import {
  isProvenanceRun,
  leafRuns,
} from "../../../../workflows/consumption-logs/lib/reconcile-production-consumption"
import { DESIGN_MODULE } from "../../../../modules/designs"
import {
  APPLIED_AT_KEY,
  APPLIED_LOCATION_KEY,
  planConsumptionApplication,
  resolveBrandLocationId,
  type ConsumptionApplyLog,
} from "../../../../workflows/consumption-logs/lib/apply-to-inventory"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — apply committed material consumption to our own inventory.
 *
 * 63 committed consumption logs on prod moved zero stock, because committing is
 * accounting-only by design (partners report burn on fabric we never owned).
 * That boundary is right for partner-held material and wrong for material
 * issued from our own warehouse. This job settles the backlog for the latter.
 *
 * Every deduction is gated on the brand store's own location, so partner-held
 * consumption is skipped rather than guessed at. Re-running is safe: an applied
 * log is stamped with `metadata.inventory_applied_at` and skipped thereafter.
 *
 * Dry-run (default) previews every decision, including the skips and why.
 */

const paramsSchema = z.object({
  design_id: z.string().min(1).optional(),
  design_ids: z.array(z.string().min(1)).optional(),
  /** Override the resolved brand location (escape hatch for a second warehouse). */
  location_id: z.string().min(1).optional(),
  limit: z.number().int().positive().optional(),
  /** Skip (don't stamp) any log whose shortfall would exceed this. */
  max_shortfall: z.number().nonnegative().optional(),
  /**
   * Treat each log's quantity as a PER-PIECE rate and multiply by the finished
   * pieces of the design's real production runs. Default true.
   */
  per_piece: z.boolean().optional(),
})

export const applyCommittedConsumptionJob: MaintenanceJob = {
  id: "apply-committed-consumption-to-inventory",
  label: "Apply committed consumption to inventory (our own stock only)",
  description:
    "Deduct committed material consumption from OUR stock — the movement that committing a consumption log has never performed. Gated on the brand store's own location: partner-held consumption is skipped, never guessed. Labour/energy logs (Hour, kWh — no inventory_item_id) are skipped. Also writes consumed_quantity/consumed_at on the design↔inventory link, which the admin UI renders but nothing has ever written. Idempotent via metadata.inventory_applied_at. Dry-run previews every decision including skips.",
  params: [
    {
      name: "design_id",
      type: "string",
      required: false,
      description: "Only this design's logs (start here — verify one before sweeping)",
    },
    {
      name: "design_ids",
      type: "string",
      required: false,
      description: "Only these designs' logs (array of design ids)",
    },
    {
      name: "location_id",
      type: "string",
      required: false,
      description:
        "Deduct from this location instead of the auto-resolved brand default location",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Cap the number of logs considered (applied after ordering)",
    },
    {
      name: "max_shortfall",
      type: "number",
      required: false,
      description:
        "Refuse any deduction short by more than this — the log is skipped, not stamped. Use 0 to apply only logs fully covered by stock on hand.",
    },
    {
      name: "per_piece",
      type: "boolean",
      required: false,
      description:
        "Treat the logged quantity as PER PIECE and multiply by the design's completed production (default true). Set false to deduct the figure verbatim.",
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
    const { design_id, design_ids, location_id, limit, max_shortfall } =
      parsed.data
    const perPiece = parsed.data.per_piece !== false

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const consumptionService: any = container.resolve(CONSUMPTION_LOG_MODULE)

    const brandLocationId =
      location_id ?? (await resolveBrandLocationId(container))

    const designFilter = design_ids?.length
      ? design_ids
      : design_id
        ? [design_id]
        : null

    const filters: Record<string, any> = { is_committed: true }
    if (designFilter) {
      filters.design_id = designFilter
    }
    const [rawLogs] = await consumptionService.listAndCountConsumptionLogs(
      filters,
      { take: null }
    )

    const logs: ConsumptionApplyLog[] = ((rawLogs || []) as any[]).map((l) => ({
      id: l.id,
      design_id: l.design_id ?? null,
      production_run_id: l.production_run_id ?? null,
      inventory_item_id: l.inventory_item_id ?? null,
      quantity: l.quantity ?? null,
      is_committed: Boolean(l.is_committed),
      location_id: l.location_id ?? null,
      metadata: l.metadata ?? null,
    }))
    const considered = [...logs]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit ?? logs.length)

    // Current stock at the brand location, per item. An item ABSENT from this
    // map has no level there — the signal that it was never ours.
    const itemIds = Array.from(
      new Set(considered.map((l) => l.inventory_item_id).filter(Boolean))
    ) as string[]
    const brandLevels: Record<string, number> = {}
    const levelIdByItem: Record<string, string> = {}
    if (itemIds.length) {
      const { data: levels } = await query.graph({
        entity: "inventory_level",
        fields: ["id", "inventory_item_id", "location_id", "stocked_quantity"],
        filters: { inventory_item_id: itemIds, location_id: brandLocationId },
      })
      for (const lv of (levels || []) as any[]) {
        brandLevels[lv.inventory_item_id] = Number(lv.stocked_quantity ?? 0)
        levelIdByItem[lv.inventory_item_id] = lv.id
      }
    }

    // A logged quantity is a PER-PIECE rate, so it has to be multiplied by what
    // the design actually finished. Pieces come from the log's own run when it
    // has one, else from the design's completed leaf runs — with provenance runs
    // excluded, since those shipped from stock and consumed nothing.
    let piecesByLog: Record<string, number> | undefined
    if (perPiece) {
      const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)
      const designIds = Array.from(
        new Set(considered.map((l) => l.design_id).filter(Boolean))
      ) as string[]
      const [rawRuns] = designIds.length
        ? await runService.listAndCountProductionRuns(
            { design_id: designIds },
            { take: null }
          )
        : [[]]
      const completed = leafRuns((rawRuns || []) as any[]).filter(
        (r: any) => r.status === "completed" && !isProvenanceRun(r)
      )
      const byDesign: Record<string, number> = {}
      const byRun: Record<string, number> = {}
      for (const r of completed as any[]) {
        const q = Number(r.produced_quantity ?? r.quantity ?? 0) || 0
        byRun[r.id] = q
        if (r.design_id) {
          byDesign[r.design_id] = (byDesign[r.design_id] ?? 0) + q
        }
      }
      piecesByLog = {}
      for (const l of considered) {
        const runPieces = l.production_run_id
          ? byRun[l.production_run_id]
          : undefined
        piecesByLog[l.id] =
          runPieces ?? (l.design_id ? byDesign[l.design_id] ?? 0 : 0)
      }
    }

    const decisions = planConsumptionApplication({
      brandLocationId,
      logs: considered,
      brandLevels,
      maxShortfall: max_shortfall,
      piecesByLog,
    })
    const applies = decisions.filter((d) => d.action === "apply") as Extract<
      (typeof decisions)[number],
      { action: "apply" }
    >[]

    const changes: MaintenanceChange[] = applies.map((d) => ({
      entity: "inventory_level",
      id: `${d.inventory_item_id}@${brandLocationId}`,
      field: `stocked_quantity (log ${d.log_id}${
        d.pieces != null ? `, ${d.per_piece}/pc × ${d.pieces} pcs` : ""
      })`,
      before: d.before,
      after: d.after,
    }))

    if (!dry_run && applies.length > 0) {
      const logById = new Map(considered.map((l) => [l.id, l]))
      const appliedAt = new Date().toISOString()

      // Final level per item — several logs may draw down one item, and the
      // planner already carried the balance forward across them, so only the
      // last decision's `after` is written.
      //
      // Deliberately the ABSOLUTE setter rather than the module's relative
      // `adjustInventory(item, location, -qty)`: the planner has already
      // floored at 0 and reported any shortfall, and a relative delta would
      // drive the level negative instead. This also matches how every other
      // level change in the repo is made (cancel-inventory-order,
      // partner-complete-inventory-order), so it inherits the workflow's
      // compensation rather than being a bare service write.
      const finalByItem = new Map<string, number>()
      for (const d of applies) {
        finalByItem.set(d.inventory_item_id, d.after)
      }
      const updates = Array.from(finalByItem, ([itemId, stocked]) => ({
        id: levelIdByItem[itemId],
        stocked_quantity: stocked,
      }))
      await updateInventoryLevelsWorkflow(container as any).run({
        input: { updates: updates as any },
      })

      for (const d of applies) {
        const existing = logById.get(d.log_id)
        await consumptionService.updateConsumptionLogs({
          id: d.log_id,
          metadata: {
            ...(existing?.metadata || {}),
            [APPLIED_AT_KEY]: appliedAt,
            [APPLIED_LOCATION_KEY]: brandLocationId,
          },
        })
      }

      await writeConsumedOnDesignLinks(container, query, applies, logById, appliedAt)
    }

    const skipReasons = decisions
      .filter((d) => d.action === "skip")
      .reduce<Record<string, number>>((acc, d) => {
        const reason = (d as any).reason.replace(/\(.*\)/, "(…)")
        acc[reason] = (acc[reason] ?? 0) + 1
        return acc
      }, {})
    const shortfalls = applies.filter((d) => d.shortfall)

    const summary = [
      `${dry_run ? "Would apply" : "Applied"} ${applies.length} of ${considered.length} committed log(s) at ${brandLocationId}`,
      shortfalls.length
        ? `⚠️ ${shortfalls.length} log(s) wanted more than the level held (floored at 0): ${shortfalls
            .map((d) => `${d.inventory_item_id} short ${d.shortfall}`)
            .join(", ")}`
        : "",
      Object.keys(skipReasons).length
        ? `Skipped: ${Object.entries(skipReasons)
            .map(([r, n]) => `${n}× ${r}`)
            .join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join(". ")

    return {
      job_id: applyCommittedConsumptionJob.id,
      dry_run,
      applied: !dry_run && applies.length > 0,
      summary,
      changes,
    }
  },
}

/**
 * Give `consumed_quantity` / `consumed_at` on the design↔inventory link their
 * first writer. The admin design UI renders both, so they have displayed 0
 * forever. Mirrors `updateDesignInventoryLinkStep`'s dismiss+create, preserving
 * every other column.
 */
async function writeConsumedOnDesignLinks(
  container: MedusaContainer,
  query: any,
  applies: Array<{ log_id: string; inventory_item_id: string; quantity: number }>,
  logById: Map<string, ConsumptionApplyLog>,
  appliedAt: string
): Promise<void> {
  const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

  // Sum this run's consumption per (design, item) pair.
  const added = new Map<string, number>()
  for (const d of applies) {
    const designId = logById.get(d.log_id)?.design_id
    if (!designId) {
      continue
    }
    const key = `${designId}::${d.inventory_item_id}`
    added.set(key, (added.get(key) ?? 0) + d.quantity)
  }

  for (const [key, quantity] of added) {
    const [designId, inventoryItemId] = key.split("::")
    try {
      const { data: rows } = await query.graph({
        entity: "design_inventory_item",
        fields: [
          "design_id",
          "inventory_item_id",
          "planned_quantity",
          "consumed_quantity",
          "consumed_at",
          "location_id",
          "metadata",
        ],
        filters: { design_id: designId, inventory_item_id: inventoryItemId },
      })
      const existing = (rows || [])[0]
      if (!existing) {
        continue
      }

      const linkDefinition = {
        [DESIGN_MODULE]: { design_id: designId },
        [Modules.INVENTORY]: { inventory_item_id: inventoryItemId },
      }
      await remoteLink.dismiss([linkDefinition])
      await remoteLink.create([
        {
          ...linkDefinition,
          data: {
            planned_quantity: existing.planned_quantity ?? null,
            consumed_quantity:
              Number(existing.consumed_quantity ?? 0) + quantity,
            consumed_at: appliedAt,
            location_id: existing.location_id ?? null,
            metadata: existing.metadata ?? null,
          },
        },
      ])
    } catch {
      // A missing/!unlinkable pair must not fail the stock correction that
      // already succeeded — the link column is a display mirror.
    }
  }
}
