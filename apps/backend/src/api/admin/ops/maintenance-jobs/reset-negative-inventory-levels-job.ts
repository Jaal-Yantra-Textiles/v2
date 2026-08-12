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

/** Read the value out of a `raw_<field>` jsonb, whatever shape it arrives in. */
const rawValue = (raw: unknown): number | null => {
  if (raw == null) {
    return null
  }
  const v =
    typeof raw === "object" && raw !== null && "value" in (raw as any)
      ? (raw as any).value
      : raw
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * PURE: levels whose two storage columns disagree. Exported for unit tests.
 *
 * `model.bigNumber()` persists a field TWICE — `<field> numeric` and
 * `raw_<field> jsonb` — and on 2026-08-11 a single row was found where they had
 * drifted apart: `FAB-TWO-BLU-001` read `0` through
 * `/admin/inventory-items/:id/location-levels` and `-2.5` through the item's
 * `location_levels` relation, which is what the admin UI renders.
 *
 * That divergence is worse than a wrong number, because it defeats the check
 * that would catch a wrong number: the negative-level sweep reported "no
 * negative levels across 194" while an operator was looking at -2.5 on screen.
 * Whichever side a tool happens to read, it is confident and it is not
 * necessarily right.
 *
 * ⚠️ This REPORTS ONLY and never picks a winner. Neither column is inherently
 * authoritative — the numeric side is what most queries filter on, the raw side
 * is what the UI shows — so choosing between them is a judgement about what
 * really happened to the stock, which belongs to a human. Same reasoning as
 * refusing to guess a null `quantity_basis` (#1248).
 */
export function findLevelValueDivergence(
  levels: Array<{
    id: string
    inventory_item_id: string
    location_id: string
    stocked_quantity: number | string | null
    raw_stocked_quantity?: unknown
    sku?: string | null
  }>
): Array<{
  level_id: string
  inventory_item_id: string
  location_id: string
  sku?: string | null
  numeric: number
  raw: number
}> {
  const out: Array<{
    level_id: string
    inventory_item_id: string
    location_id: string
    sku?: string | null
    numeric: number
    raw: number
  }> = []

  for (const lv of levels ?? []) {
    const raw = rawValue(lv?.raw_stocked_quantity)
    if (raw == null) {
      // Not every read path returns the raw column; absence is not disagreement.
      continue
    }
    const numeric = Number(lv?.stocked_quantity ?? 0)
    if (!Number.isFinite(numeric) || numeric === raw) {
      continue
    }
    out.push({
      level_id: lv.id,
      inventory_item_id: lv.inventory_item_id,
      location_id: lv.location_id,
      sku: lv.sku ?? null,
      numeric,
      raw,
    })
  }

  return out
}

/**
 * PURE: how many levels the divergence check could actually compare. Exported
 * for unit tests.
 *
 * `findLevelValueDivergence` skips any row missing a readable `raw_` column —
 * absence is not disagreement — which means a detector that never receives that
 * column reports "clean" forever. A dead detector and a working one print
 * IDENTICAL output. That is the same trap that produced three false "no
 * matches" while tracing the original bug (#1259): a zero means nothing unless
 * you know the denominator.
 *
 * So the job states its denominator. `compared 194/194` is evidence; `compared
 * 0/194` is visibly useless instead of quietly reassuring.
 *
 * The skip conditions here MUST mirror `findLevelValueDivergence` exactly — a
 * count that disagrees with the check it describes is worse than no count.
 */
export function countComparableLevels(
  levels: Array<{
    stocked_quantity?: number | string | null
    raw_stocked_quantity?: unknown
  }>
): { compared: number; total: number } {
  let compared = 0

  for (const lv of levels ?? []) {
    const raw = rawValue(lv?.raw_stocked_quantity)
    if (raw == null) {
      continue
    }
    if (!Number.isFinite(Number(lv?.stocked_quantity ?? 0))) {
      continue
    }
    compared++
  }

  return { compared, total: (levels ?? []).length }
}

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
    raw_stocked_quantity?: unknown
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
    // BOTH columns, and the WORST of them. Reading one side is exactly how the
    // first version of this job missed the live case: it saw `stocked_quantity`
    // 0 and reported "no negative levels across 194" while the admin UI, which
    // renders the raw side, showed -2.5. A level is bad if EITHER side is.
    const numeric = Number(lv?.stocked_quantity ?? 0)
    const raw = rawValue(lv?.raw_stocked_quantity)
    const candidates = [numeric, raw].filter(
      (n): n is number => n != null && Number.isFinite(n)
    )
    if (!candidates.length) {
      continue
    }
    const before = Math.min(...candidates)
    if (before >= 0) {
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
    "Find inventory levels with a negative stocked quantity and reset them to 0, and report levels whose two stored values disagree. A negative level is never a real position — it is the residue of a movement recorded with no counterpart, and available_quantity inherits the sign, so allocation downstream reasons about a balance that cannot exist. Reads BOTH halves of the bigNumber pair (numeric and raw_), because reading one side is how a level showing -2.5 in the admin was reported clean. Divergence is reported, never auto-resolved — neither side is inherently authoritative. ⚠️ If a negative is really an un-recorded receipt, record the receipt instead of zeroing it — read the dry-run first. Safe to re-run as a periodic check.",
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
      fields: [
        "id",
        "inventory_item_id",
        "location_id",
        "stocked_quantity",
        // The other half of the bigNumber pair. Without it this job reads one
        // side of the row and is confidently wrong when they disagree.
        "raw_stocked_quantity",
      ],
      ...(Object.keys(filters).length ? { filters } : {}),
    })

    const resets = planNegativeLevelResets((levels || []) as any[], {
      maxMagnitude: parsed.data.max_magnitude,
    })
    const divergent = findLevelValueDivergence((levels || []) as any[])
    const coverage = countComparableLevels((levels || []) as any[])

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

    const summary = [
      resets.length
        ? `${dry_run ? "Would reset" : "Reset"} ${resets.length} negative level(s) to 0: ${resets
            .map((r) => `${r.inventory_item_id}@${r.location_id} was ${r.before}`)
            .join(", ")}`
        : `No negative stock levels found across ${(levels || []).length} level(s)`,
      // Reported, never auto-resolved — see findLevelValueDivergence.
      divergent.length
        ? `⚠️ ${divergent.length} level(s) whose two stored values DISAGREE (the UI shows the raw one): ${divergent
            .map(
              (d) =>
                `${d.inventory_item_id}@${d.location_id} numeric=${d.numeric} raw=${d.raw}`
            )
            .join(
              ", "
            )}. Not resolved automatically — decide which is true, then write it with POST /admin/inventory-items/:id/location-levels/:location_id, which rewrites both.`
        : "",
      // ALWAYS stated, in both directions. Without it "no divergence" is
      // unfalsifiable: it reads the same whether the check ran on every row or
      // on none (#1259).
      coverage.compared === coverage.total
        ? `Compared ${coverage.compared}/${coverage.total} level(s) — both stored values present on every row`
        : `⚠️ Compared only ${coverage.compared}/${coverage.total} level(s) — the rest did not return a readable raw_stocked_quantity, so the divergence check DID NOT look at them${
            coverage.compared === 0
              ? ". A 0/N reading means the divergence check is inert, NOT that the data agrees."
              : ""
          }`,
    ]
      .filter(Boolean)
      .join(". ")

    return {
      job_id: resetNegativeInventoryLevelsJob.id,
      dry_run,
      applied: !dry_run && resets.length > 0,
      summary,
      changes,
    }
  },
}
