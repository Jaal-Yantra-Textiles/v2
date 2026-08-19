import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { LinkDefinition, MedusaContainer } from "@medusajs/framework/types"
import type { Link } from "@medusajs/modules-sdk"

import ProductionRunInventoryLink from "../links/production-run-inventory-link"
import DesignInventoryLink from "../links/design-inventory-link"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import {
  normalizeRunMaterials,
  type NormalizedRunMaterial,
  type RunMaterialInput,
} from "../workflows/production-runs/lib/run-materials"

export type RunAllocationRow = {
  inventory_item_id: string
  planned_quantity: number | null
  location_id: string | null
  resolved_raw_material_id: string | null
  note: string | null
  metadata: Record<string, any> | null
  inventory_item?: any
}

/**
 * Read a run's material allocation — the items THIS run was assigned, as
 * opposed to everything its design can be made of.
 *
 * Returns `[]` for every run that predates the allocation and for any run
 * approved without a `materials` array. That emptiness is load-bearing and must
 * be passed on unchanged: callers distinguish "no selection was made" (the run
 * is unconstrained, keep the old whole-BOM behaviour) from "these items and no
 * others". Do not paper over it with the design BOM here — the caller needs to
 * know which of the two it is looking at.
 */
export const readRunAllocation = async (
  container: MedusaContainer,
  productionRunId: string
): Promise<RunAllocationRow[]> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data } = await query.graph({
    entity: ProductionRunInventoryLink.entryPoint,
    fields: [
      "inventory_item_id",
      "planned_quantity",
      "location_id",
      "resolved_raw_material_id",
      "note",
      "metadata",
      "inventory_item.id",
      "inventory_item.title",
      "inventory_item.sku",
    ],
    filters: { production_runs_id: productionRunId },
  })

  return (data || [])
    .filter((row: any) => row?.inventory_item_id)
    .map((row: any) => ({
      inventory_item_id: row.inventory_item_id,
      planned_quantity:
        row.planned_quantity === null || row.planned_quantity === undefined
          ? null
          : Number(row.planned_quantity),
      location_id: row.location_id ?? null,
      resolved_raw_material_id: row.resolved_raw_material_id ?? null,
      note: row.note ?? null,
      metadata: row.metadata ?? null,
      inventory_item: row.inventory_item ?? null,
    }))
}

/** Readable labels for a refusal message: `iitem_x` helps nobody on a shop floor. */
export const allocationLabels = (
  rows: RunAllocationRow[]
): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const r of rows) {
    const label = r.inventory_item?.title || r.inventory_item?.sku
    if (label) out[r.inventory_item_id] = label
  }
  return out
}

/**
 * Replace a run's allocation wholesale.
 *
 * Wholesale on purpose, and worth saying out loud: this is the same shape as
 * `PUT /admin/production-run-policy`, which replaces its config entirely — a
 * caller sending a partial list gets a partial allocation, not a merge. Sending
 * an empty array (or null) clears the allocation and returns the run to
 * unconstrained, which is a real and sometimes correct outcome: it means "I no
 * longer want to narrow what this partner may use".
 *
 * Validates against the design's bill of materials BEFORE dismissing anything,
 * so a rejected edit leaves the existing allocation exactly as it was.
 */
export const setRunAllocation = async (
  container: MedusaContainer,
  input: {
    production_run_id: string
    design_id: string | null
    materials: RunMaterialInput[] | null | undefined
  }
): Promise<NormalizedRunMaterial[]> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  let bomItemIds: string[] | null = null
  if (input.design_id && input.materials?.length) {
    const { data: bomRows } = await query.graph({
      entity: DesignInventoryLink.entryPoint,
      fields: ["inventory_item_id"],
      filters: { design_id: input.design_id },
    })
    bomItemIds = (bomRows || [])
      .map((r: any) => r.inventory_item_id)
      .filter(Boolean)
  }

  const normalized = normalizeRunMaterials(input.materials, bomItemIds)
  if (!normalized.ok) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, normalized.error)
  }

  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
  const existing = await readRunAllocation(container, input.production_run_id)

  if (existing.length) {
    await remoteLink.dismiss(
      existing.map((row) => ({
        [PRODUCTION_RUNS_MODULE]: {
          production_runs_id: input.production_run_id,
        },
        [Modules.INVENTORY]: { inventory_item_id: row.inventory_item_id },
      })) as LinkDefinition[]
    )
  }

  if (normalized.materials.length) {
    await remoteLink.create(
      normalized.materials.map((m) => ({
        [PRODUCTION_RUNS_MODULE]: {
          production_runs_id: input.production_run_id,
        },
        [Modules.INVENTORY]: { inventory_item_id: m.inventory_item_id },
        data: {
          planned_quantity: m.planned_quantity,
          location_id: m.location_id,
          resolved_raw_material_id: m.resolved_raw_material_id,
          note: m.note,
          metadata: m.metadata,
        },
      })) as LinkDefinition[]
    )
  }

  return normalized.materials
}
