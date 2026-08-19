/**
 * Which materials to offer a partner for a run.
 *
 * The consumption picker used to read `design.inventory_items` — the design's
 * whole bill of materials — so a design with five items handed to two partners
 * asked both of them about all five. A run can now be ASSIGNED a subset, and
 * the backend REFUSES consumption outside it, so offering the full BOM would
 * mean offering choices the save is going to reject.
 *
 * The fallback is the important half: a run with no allocation is unconstrained
 * (nobody chose — not "chose nothing"), and every run that predates the feature
 * is in that state. Those must keep seeing the full BOM.
 */
export type RunMaterialOption = {
  id: string
  title?: string
  sku?: string
  /** Set only when the run was allocated this item. */
  planned_quantity?: number | null
}

export const resolveRunMaterialOptions = (
  run: any,
  design: any
): { options: RunMaterialOption[]; constrained: boolean } => {
  const allocation = Array.isArray(run?.materials) ? run.materials : []

  if (allocation.length) {
    return {
      constrained: true,
      options: allocation.map((row: any) => ({
        id: row.inventory_item_id,
        title: row.inventory_item?.title,
        sku: row.inventory_item?.sku,
        planned_quantity:
          row.planned_quantity === null || row.planned_quantity === undefined
            ? null
            : Number(row.planned_quantity),
      })),
    }
  }

  const bom = Array.isArray(design?.inventory_items) ? design.inventory_items : []
  return {
    constrained: false,
    options: bom.map((item: any) => ({
      id: item.id,
      title: item.title,
      sku: item.sku,
    })),
  }
}
