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
  levelKey,
  planConsumptionApplication,
  resolveBrandLocationId,
  resolveCoreLocationIds,
  resolveLocationsFromLevels,
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
 * Every deduction is gated on a location WE hold the material at, so
 * partner-held consumption is skipped rather than guessed at.
 *
 * Which location that is comes from the MATERIAL, not from the design: an
 * inventory item stocked in exactly one place was drawn from that place. The
 * design↔inventory link's `location_id` ("Preferred location") still wins when
 * an operator has set one, and the brand default catches whatever neither can
 * place. Deriving it from stock is also what carries the ownership boundary —
 * material with no stock anywhere is material we do not hold.
 *
 * Re-running is safe: an applied log is stamped with
 * `metadata.inventory_applied_at` and skipped thereafter.
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
  /** Basis to assume for legacy logs whose quantity_basis is null. */
  assume_basis: z.enum(["total", "per_piece"]).optional(),
})

export const applyCommittedConsumptionJob: MaintenanceJob = {
  id: "apply-committed-consumption-to-inventory",
  label: "Apply committed consumption to inventory (our own stock only)",
  description:
    "Deduct committed material consumption from OUR stock — the movement that committing a consumption log has never performed. Each log deducts from wherever that material is actually stocked (a design's Preferred location overrides it, the brand default catches the rest); material stocked nowhere is partner-held and skipped, never guessed. Labour/energy logs (Hour, kWh — no inventory_item_id) are skipped. Also writes consumed_quantity/consumed_at on the design↔inventory link, which the admin UI renders but nothing has ever written. Idempotent via metadata.inventory_applied_at. Dry-run previews every decision including skips.",
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
        "Force every deduction to this location, overriding both each design's Preferred location and the brand default. Use when the brand store cannot be resolved automatically.",
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
      name: "assume_basis",
      type: "string",
      required: false,
      description:
        "total | per_piece — how to read logs written before the form recorded a basis. Omit and those logs are skipped rather than guessed.",
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
    const assumeBasis = parsed.data.assume_basis

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const consumptionService: any = container.resolve(CONSUMPTION_LOG_MODULE)

    // Which locations are ours. An explicit location_id param is the operator
    // asserting one, so it stands in for the whole set.
    //
    // `brandLocationId` is only the LAST-RESORT fallback for a log nothing else
    // could place. Once ownership is recorded it is no longer the point of the
    // job, and `resolveBrandLocationId` throws whenever two stores look like
    // the brand (prod, today) — so a failure to determine it must not take the
    // whole run down. Empty string means "unresolved", which is never core, so
    // such logs skip with a reason instead of landing somewhere arbitrary.
    let coreLocationIds: Set<string>
    let seeded: boolean
    let brandLocationId: string

    if (location_id) {
      coreLocationIds = new Set([location_id])
      seeded = true
      brandLocationId = location_id
    } else {
      const resolved = await resolveCoreLocationIds(container)
      coreLocationIds = resolved.coreLocationIds
      seeded = resolved.seeded
      brandLocationId = resolved.seeded
        ? await resolveBrandLocationId(container).catch(() => "")
        : (Array.from(resolved.coreLocationIds)[0] ?? "")
    }

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
      quantity_basis: l.quantity_basis ?? null,
      inventory_item_id: l.inventory_item_id ?? null,
      quantity: l.quantity ?? null,
      is_committed: Boolean(l.is_committed),
      location_id: l.location_id ?? null,
      metadata: l.metadata ?? null,
    }))
    const considered = [...logs]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, limit ?? logs.length)

    const itemIds = Array.from(
      new Set(considered.map((l) => l.inventory_item_id).filter(Boolean))
    ) as string[]

    // EVERY level for these items, at every location — not just the brand's.
    // Where a material sits is what decides the deduction, so the levels have
    // to be read before the location is known rather than after.
    let allLevels: any[] = []
    if (itemIds.length) {
      const { data } = await query.graph({
        entity: "inventory_level",
        fields: ["id", "inventory_item_id", "location_id", "stocked_quantity"],
        filters: { inventory_item_id: itemIds },
      })
      allLevels = (data || []) as any[]
    }

    // Where each log draws from, most specific first:
    //   explicit param  >  design's Preferred location  >  where the material is
    //   >  brand default
    // The param is the operator's escape hatch and overrides everything.
    const locationByLog = location_id
      ? {}
      : await resolveLocationByLog(query, considered, allLevels, coreLocationIds)

    const brandLevels: Record<string, number> = {}
    const levelsAtLocation: Record<string, number> = {}
    const levelIdByKey: Record<string, string> = {}
    for (const lv of allLevels) {
      const key = levelKey(lv.inventory_item_id, lv.location_id)
      const stocked = Number(lv.stocked_quantity ?? 0)
      levelIdByKey[key] = lv.id
      if (lv.location_id === brandLocationId) {
        brandLevels[lv.inventory_item_id] = stocked
      } else {
        levelsAtLocation[key] = stocked
      }
    }

    // A logged quantity is a PER-PIECE rate, so it has to be multiplied by what
    // the design actually finished. Pieces come from the log's own run when it
    // has one, else from the design's completed leaf runs — with provenance runs
    // excluded, since those shipped from stock and consumed nothing.
    let piecesByLog: Record<string, number> | undefined
    {
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
      locationByLog,
      levelsAtLocation,
      coreLocationIds,
      maxShortfall: max_shortfall,
      piecesByLog,
      assumeBasisWhenUnknown: assumeBasis,
    })
    const applies = decisions.filter((d) => d.action === "apply") as Extract<
      (typeof decisions)[number],
      { action: "apply" }
    >[]

    const changes: MaintenanceChange[] = applies.map((d) => ({
      entity: "inventory_level",
      id: levelKey(d.inventory_item_id, d.location_id),
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
      const finalByLevel = new Map<
        string,
        { inventory_item_id: string; location_id: string; stocked: number }
      >()
      for (const d of applies) {
        finalByLevel.set(levelKey(d.inventory_item_id, d.location_id), {
          inventory_item_id: d.inventory_item_id,
          location_id: d.location_id,
          stocked: d.after,
        })
      }
      // `inventory_item_id` + `location_id` are REQUIRED, not decoration:
      // `updateInventoryLevels_` ignores `id` entirely and re-resolves the level
      // from the item/location pair. Passing the level id alone made it look up
      // `(undefined, undefined)` and die with `Item undefined is not stocked at
      // location undefined` — which is what the first prod apply hit. The step's
      // compensation reads the same two fields, so omitting them also left the
      // rollback with nothing to restore. Matches how cancel-inventory-order and
      // partner-complete-inventory-order already shape their updates.
      const updates = Array.from(finalByLevel, ([key, lvl]) => ({
        id: levelIdByKey[key],
        inventory_item_id: lvl.inventory_item_id,
        location_id: lvl.location_id,
        stocked_quantity: lvl.stocked,
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
            [APPLIED_LOCATION_KEY]: d.location_id,
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
      `${dry_run ? "Would apply" : "Applied"} ${applies.length} of ${considered.length} committed log(s) at ${
        Array.from(new Set(applies.map((d) => d.location_id))).join(", ") ||
        brandLocationId
      }`,
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
      seeded
        ? ""
        : "⚠️ no location ownership recorded yet — fell back to the inferred brand default. Mark your locations core to deduct from more than one warehouse.",
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
 * Map each log to the location that material is drawn from.
 *
 * Two sources, in order:
 *
 * 1. The design↔inventory link's `location_id` — "Preferred location" in the
 *    admin drawer. An explicit operator statement, so it wins.
 * 2. Failing that, WHERE THE MATERIAL ACTUALLY IS: the item's own stock levels
 *    (`resolveLocationsFromLevels`). This is the one that does the work —
 *    every design carrying an unsettled material log on prod has the link's
 *    location null, so relying on it alone would resolve nothing.
 *
 * A log neither source can place is omitted, and the planner falls back to the
 * brand default — which is what skips partner-held material, since it has no
 * level there.
 */
async function resolveLocationByLog(
  query: any,
  logs: ConsumptionApplyLog[],
  allLevels: Array<{
    inventory_item_id: string
    location_id: string
    stocked_quantity: number | string | null
  }>,
  coreLocationIds: Set<string>
): Promise<Record<string, string>> {
  const byMaterial = resolveLocationsFromLevels(allLevels, coreLocationIds)

  const pairs = logs.filter((l) => l.design_id && l.inventory_item_id)
  if (!pairs.length) {
    // Still place logs by their material even with no design attached.
    return Object.fromEntries(
      logs
        .filter((l) => l.inventory_item_id && byMaterial[l.inventory_item_id])
        .map((l) => [l.id, byMaterial[l.inventory_item_id as string]])
    )
  }

  const { data: links } = await query.graph({
    entity: "design_inventory_item",
    fields: ["design_id", "inventory_item_id", "location_id"],
    filters: {
      design_id: Array.from(new Set(pairs.map((l) => l.design_id))),
      inventory_item_id: Array.from(
        new Set(pairs.map((l) => l.inventory_item_id))
      ),
    },
  })

  // Keyed on the PAIR: one design links several materials, each of which may
  // sit in a different warehouse.
  const byPair = new Map<string, string>()
  for (const row of (links || []) as any[]) {
    if (row?.location_id) {
      byPair.set(`${row.design_id}::${row.inventory_item_id}`, row.location_id)
    }
  }

  const out: Record<string, string> = {}
  for (const l of logs) {
    const loc =
      byPair.get(`${l.design_id}::${l.inventory_item_id}`) ??
      (l.inventory_item_id ? byMaterial[l.inventory_item_id] : undefined)
    if (loc) {
      out[l.id] = loc
    }
  }
  return out
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
