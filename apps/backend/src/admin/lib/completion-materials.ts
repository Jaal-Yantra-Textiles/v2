/**
 * The "Material used" rows of the admin's complete-run form, and the
 * `consumptions` they send.
 *
 * Prefilled from what the run was planned to use, so closing a run from a
 * partner's WhatsApp ("done, all cloth used") is one click rather than a
 * separate log-and-commit afterwards (prod 2026-11-04, Prince's denim run).
 * Source order: the run's own allocation (`materials`, what it was SENT), else
 * the design's bill of materials captured on the run (`snapshot.inventory_links`).
 *
 * 🔴 Every line is sent with `quantity_basis: "total"` — the form asks what the
 * whole run used, and a line without a basis never comes off stock.
 */

export type CompletionMaterialRow = {
  inventory_item_id: string
  title: string
  quantity: string
  unit_cost: string
  unit_of_measure: string
}

const UNITS = new Set([
  "Meter",
  "Yard",
  "Kilogram",
  "Gram",
  "Piece",
  "Roll",
  "kWh",
  "Liter",
  "Cubic_Meter",
  "Hour",
  "Other",
])

const str = (n: unknown) => {
  const v = Number(n)
  return n != null && n !== "" && Number.isFinite(v) && v > 0 ? String(v) : ""
}

const unit = (u: unknown) => (typeof u === "string" && UNITS.has(u) ? u : "Meter")

/** Rows to prefill from a run detail (`GET /admin/production-runs/:id`). */
export const completionMaterialRows = (
  run: Record<string, any> | null | undefined,
  allocation: Array<Record<string, any>> | null | undefined
): CompletionMaterialRow[] => {
  const links: Array<Record<string, any>> = run?.snapshot?.inventory_links ?? []
  const linkByItem = new Map(links.map((l) => [l.inventory_item_id, l]))

  const source = allocation?.length ? allocation : links
  const seen = new Set<string>()
  const rows: CompletionMaterialRow[] = []
  for (const row of source) {
    const id = row?.inventory_item_id
    if (!id || seen.has(id)) continue
    seen.add(id)
    const link = linkByItem.get(id)
    const item = row.inventory_item ?? link?.inventory_item ?? {}
    const raw = item.raw_materials ?? link?.inventory_item?.raw_materials ?? {}
    rows.push({
      inventory_item_id: id,
      title: item.title || item.sku || raw.name || id,
      quantity: str(row.planned_quantity ?? link?.planned_quantity),
      unit_cost: str(raw.unit_cost),
      unit_of_measure: unit(raw.unit_of_measure),
    })
  }
  return rows
}

export type CompletionConsumption = {
  inventory_item_id: string
  quantity: number
  quantity_basis: "total"
  unit_cost?: number
  unit_of_measure: string
}

/** Rows with a positive quantity, as the complete route's `consumptions`. */
export const completionConsumptionsPayload = (
  rows: CompletionMaterialRow[]
): CompletionConsumption[] =>
  rows
    .filter((r) => Number(r.quantity) > 0)
    .map((r) => ({
      inventory_item_id: r.inventory_item_id,
      quantity: Number(r.quantity),
      quantity_basis: "total" as const,
      unit_cost: Number(r.unit_cost) > 0 ? Number(r.unit_cost) : undefined,
      unit_of_measure: r.unit_of_measure,
    }))
