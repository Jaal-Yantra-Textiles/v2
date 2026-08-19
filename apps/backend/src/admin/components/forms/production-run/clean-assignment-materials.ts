/**
 * What an assignment's material rows should become on save.
 *
 * #1361 is the reason this is a pure function with its own tests rather than a
 * few lines inside the submit handler: the spec editor seeded a blank row by
 * design, forgot to clean it, and answered a partner with
 * `options, 0, values, 0, label` — a form that produced a payload the same form
 * then rejected. The material picker has the identical shape. A chip that was
 * toggled on and then off, or toggled on and never given a quantity, must not
 * reach the API as `{ inventory_item_id: "", planned_quantity: 0 }`.
 *
 * Two cases that must NOT be treated alike:
 *
 *  - a row nobody selected is NOISE — dropped silently, like an untouched chip;
 *  - a SELECTED item with a quantity that was typed and then emptied down to
 *    zero or a non-number is a MISTAKE. The backend rejects a non-positive
 *    planned_quantity, so returning it here in words beats a zod path.
 *
 * A selected item with NO quantity at all is legitimate: it means "this partner
 * gets this material, amount unstated", which the backend stores as null.
 */
export type DraftMaterial = {
  inventory_item_id: string
  selected?: boolean
  /** As typed. "" means the admin has not stated an amount. */
  planned_quantity?: string | number | null
  note?: string | null
}

export type CleanedMaterial = {
  inventory_item_id: string
  planned_quantity?: number
  note?: string
}

export type CleanMaterialsResult =
  | { ok: true; materials: CleanedMaterial[] }
  | { ok: false; error: string }

export const cleanAssignmentMaterialsForSave = (
  drafts: DraftMaterial[] | null | undefined,
  labelFor: (inventoryItemId: string) => string = (id) => id
): CleanMaterialsResult => {
  const out: CleanedMaterial[] = []

  for (const draft of drafts || []) {
    const id = (draft?.inventory_item_id || "").trim()
    if (!id || !draft?.selected) {
      continue
    }

    const raw = draft.planned_quantity
    const stated = raw !== undefined && raw !== null && String(raw).trim() !== ""

    if (!stated) {
      out.push({ inventory_item_id: id, ...(draft.note ? { note: draft.note } : {}) })
      continue
    }

    const qty = Number(raw)
    if (!Number.isFinite(qty) || qty <= 0) {
      return {
        ok: false,
        error: `Enter a quantity greater than 0 for ${labelFor(id)}, or clear it to leave the amount unstated.`,
      }
    }

    out.push({
      inventory_item_id: id,
      planned_quantity: qty,
      ...(draft.note ? { note: draft.note } : {}),
    })
  }

  return { ok: true, materials: out }
}
