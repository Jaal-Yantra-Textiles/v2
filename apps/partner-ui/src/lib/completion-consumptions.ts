/**
 * The `consumptions` a partner's completion sends, from the form's rows.
 *
 * 🔴 `quantity_basis` is "total": the form asks what was consumed during THIS
 * run, so the number is everything the run used, not one piece's worth. The
 * server never takes a material off stock without a basis (prod 2026-10-13:
 * every partner completion log was skipped as "quantity_basis unknown").
 */
export type ConsumptionFormRow = {
  inventory_item_id: string
  quantity: string
  unit_cost: string
  unit_of_measure: string
  notes: string
}

export type ConsumptionPayload = {
  inventory_item_id: string
  quantity: number
  quantity_basis: "total"
  unit_cost?: number
  unit_of_measure: string
  notes?: string
}

export function buildConsumptionsPayload(rows: ConsumptionFormRow[]): ConsumptionPayload[] {
  return rows
    .filter((c) => c.quantity && parseFloat(c.quantity) > 0)
    .map((c) => ({
      inventory_item_id: c.inventory_item_id,
      quantity: parseFloat(c.quantity),
      quantity_basis: "total" as const,
      unit_cost: c.unit_cost ? parseFloat(c.unit_cost) : undefined,
      unit_of_measure: c.unit_of_measure,
      notes: c.notes || undefined,
    }))
}
