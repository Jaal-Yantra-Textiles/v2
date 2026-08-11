import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { updateInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Data Plumbing — bring negative stocked quantities back to zero.
 *
 * A negative level says more material left than ever arrived. It is never a
 * real position: you cannot hold minus two and a half metres of cloth. It is
 * the residue of a movement recorded with no counterpart — and it is quietly
 * corrosive, because `available_quantity` inherits the sign and every
 * allocation decision downstream then reasons about a balance that cannot
 * exist.
 *
 * The live case (2026-08-11): `FAB-TWO-BLU-001` sat at **-2.5** at Shramdaan
 * India Warehouse, the only level that material has anywhere. No inventory
 * order ever moved it there — all 15 orders, 64 lines, none reference it — so
 * there is no receipt to reconcile against and nothing to net it off. One
 * negative out of 194 levels across 219 items.
 *
 * ⚠️ This job does NOT explain the movement, and deliberately records the
 * before value on every change so the write is auditable. If a negative turns
 * out to be a genuine un-recorded receipt, the fix is to record the receipt,
 * NOT to zero it — read the dry-run before applying.
 */

const paramsSchema = z.object({
  /** Only this item, e.g. a single known bad level. */
  inventory_item_id: z.string().min(1).optional(),
  /** Only levels at this location. */
  location_id: z.string().min(1).optional(),
  /**
   * Refuse to touch anything more negative than this. A level at -0.5 is
   * rounding residue; one at -400 is a broken integration, and zeroing it would
   * erase the only evidence.
   */
  max_magnitude: z.number().positive().optional(),
})

/**
 * PURE: which levels to reset, and to what. Exported for unit tests.
 *
 * Only strictly-negative levels qualify — zero is already correct and must not
 * produce a no-op write, which is what keeps `applied` honest.
 */
export function planNegativeLevelResets(
  levels: Array<{
    id: string
    inventory_item_id: string
    location_id: string
    stocked_quantity: number | string | null
    sku?: string | null
  }>,
  options: { maxMagnitude?: number } = {}
): Array<{
  level_id: string
  inventory_item_id: string
  location_id: string
  sku?: string | null
  before: number
  after: number
}> {
  const out: Array<{
    level_id: string
    inventory_item_id: string
    location_id: string
    sku?: string | null
    before: number
    after: number
  }> = []

  for (const lv of levels ?? []) {
    const before = Number(lv?.stocked_quantity ?? 0)
    if (!Number.isFinite(before) || before >= 0) {
      continue
    }
    if (options.maxMagnitude != null && Math.abs(before) > options.maxMagnitude) {
      continue
    }
    out.push({
      level_id: lv.id,
      inventory_item_id: lv.inventory_item_id,
      location_id: lv.location_id,
      sku: lv.sku ?? null,
      before,
      after: 0,
    })
  }

  return out
}

export const resetNegativeInventoryLevelsJob: MaintenanceJob = {
  id: "reset-negative-inventory-levels",
  label: "Bring negative stock levels back to zero",
  description:
    "Find inventory levels with a negative stocked quantity and reset them to 0. A negative level is never a real position — it is the residue of a movement recorded with no counterpart, and available_quantity inherits the sign, so allocation downstream reasons about a balance that cannot exist. Reports every level it would touch with its current value. ⚠️ If a negative is really an un-recorded receipt, record the receipt instead of zeroing it — read the dry-run first. Safe to re-run as a periodic check: with nothing negative it reports no changes.",
  params: [
    {
      name: "inventory_item_id",
      type: "string",
      required: false,
      description: "Only this inventory item",
    },
    {
      name: "location_id",
      type: "string",
      required: false,
      description: "Only levels at this stock location",
    },
    {
      name: "max_magnitude",
      type: "number",
      required: false,
      description:
        "Refuse anything more negative than this. A level at -0.5 is residue; one at -400 is a broken integration whose evidence should not be erased.",
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

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const filters: Record<string, any> = {}
    if (parsed.data.inventory_item_id) {
      filters.inventory_item_id = parsed.data.inventory_item_id
    }
    if (parsed.data.location_id) {
      filters.location_id = parsed.data.location_id
    }

    const { data: levels } = await query.graph({
      entity: "inventory_level",
      fields: ["id", "inventory_item_id", "location_id", "stocked_quantity"],
      ...(Object.keys(filters).length ? { filters } : {}),
    })

    const resets = planNegativeLevelResets((levels || []) as any[], {
      maxMagnitude: parsed.data.max_magnitude,
    })

    const changes: MaintenanceChange[] = resets.map((r) => ({
      entity: "inventory_level",
      id: `${r.inventory_item_id}@${r.location_id}`,
      field: "stocked_quantity",
      before: r.before,
      after: r.after,
    }))

    if (!dry_run && resets.length > 0) {
      // `inventory_item_id` + `location_id` are REQUIRED, not decoration:
      // `updateInventoryLevels_` ignores `id` and re-resolves the level from
      // the pair. Passing the level id alone dies with "Item undefined is not
      // stocked at location undefined" (#1251).
      await updateInventoryLevelsWorkflow(container as any).run({
        input: {
          updates: resets.map((r) => ({
            id: r.level_id,
            inventory_item_id: r.inventory_item_id,
            location_id: r.location_id,
            stocked_quantity: r.after,
          })) as any,
        },
      })
    }

    const summary = resets.length
      ? `${dry_run ? "Would reset" : "Reset"} ${resets.length} negative level(s) to 0: ${resets
          .map((r) => `${r.inventory_item_id}@${r.location_id} was ${r.before}`)
          .join(", ")}`
      : `No negative stock levels found across ${(levels || []).length} level(s)`

    return {
      job_id: resetNegativeInventoryLevelsJob.id,
      dry_run,
      applied: !dry_run && resets.length > 0,
      summary,
      changes,
    }
  },
}
