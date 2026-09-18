// The per-assignment material allocation, as pure rules.
//
// A design's bill of materials answers "what can this design be made of". It has
// never answered "what is THIS partner being sent", and the two were conflated:
// every run snapshotted the whole BOM and every partner was asked to account for
// all of it. These functions are the missing distinction, kept free of the
// container so the rules can be exercised directly — including the cases where
// they must NOT fire.

export type RunMaterialInput = {
  inventory_item_id: string
  /** How much of this item the assignment gets. Omit to leave unstated. */
  planned_quantity?: number | null
  location_id?: string | null
  /** #817 S4 — the colour chosen for this run, when the design pinned a group. */
  resolved_raw_material_id?: string | null
  note?: string | null
  metadata?: Record<string, any> | null
}

export type NormalizedRunMaterial = Required<
  Pick<RunMaterialInput, "inventory_item_id">
> & {
  planned_quantity: number | null
  location_id: string | null
  resolved_raw_material_id: string | null
  note: string | null
  metadata: Record<string, any> | null
}

export type NormalizeResult =
  | { ok: true; materials: NormalizedRunMaterial[] }
  | { ok: false; error: string }

/**
 * Validate and normalise an assignment's `materials` array.
 *
 * `designInventoryItemIds` is the design's BOM. Pass `null` when the run has no
 * design (the #1112 product-only provenance path) — there is nothing to be a
 * subset OF, so the subset rule is skipped rather than failing everything.
 *
 * Rejects rather than repairs, in three cases that a silent fix would turn into
 * a wrong material issue:
 *
 *  - an item the design does not use — allocating it means someone picked from
 *    the wrong design, and quietly dropping it ships a partner a short BOM;
 *  - the same item twice — two answers to "how much", and last-wins would pick
 *    one at random;
 *  - a non-positive planned_quantity — "allocate 0 of the silk" is not an
 *    allocation, it is an omission written down, and it would pass the
 *    consumption gate while promising nothing.
 */
export const normalizeRunMaterials = (
  materials: RunMaterialInput[] | null | undefined,
  designInventoryItemIds: string[] | null
): NormalizeResult => {
  if (materials === null || materials === undefined) {
    return { ok: true, materials: [] }
  }
  if (!Array.isArray(materials)) {
    return { ok: false, error: "materials must be an array" }
  }

  const bom = designInventoryItemIds ? new Set(designInventoryItemIds) : null
  const seen = new Set<string>()
  const out: NormalizedRunMaterial[] = []

  for (const raw of materials) {
    const id = typeof raw?.inventory_item_id === "string"
      ? raw.inventory_item_id.trim()
      : ""
    if (!id) {
      return { ok: false, error: "each material needs an inventory_item_id" }
    }
    if (seen.has(id)) {
      return {
        ok: false,
        error: `inventory item ${id} is listed twice; give it one planned_quantity`,
      }
    }
    if (bom && !bom.has(id)) {
      return {
        ok: false,
        error: `inventory item ${id} is not part of this design's bill of materials — link it to the design first`,
      }
    }

    const qty = raw.planned_quantity
    if (qty !== undefined && qty !== null) {
      if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) {
        return {
          ok: false,
          error: `planned_quantity for ${id} must be a positive number`,
        }
      }
    }

    seen.add(id)
    out.push({
      inventory_item_id: id,
      planned_quantity: qty === undefined || qty === null ? null : qty,
      location_id: raw.location_id ?? null,
      resolved_raw_material_id: raw.resolved_raw_material_id ?? null,
      note: raw.note ?? null,
      metadata: raw.metadata ?? null,
    })
  }

  return { ok: true, materials: out }
}

export type ConsumptionGateResult =
  | { allowed: true; constrained: boolean }
  | { allowed: false; reason: string }

/**
 * May this run log consumption against this inventory item?
 *
 * The load-bearing case is the one that must stay open: **a run with no
 * allocation is unconstrained**. Every run that existed before this feature has
 * zero allocation rows, as does any assignment made without a `materials` array,
 * and treating "nobody chose" the same as "chose nothing" would 400 the entire
 * existing floor. The gate engages only once a selection actually exists.
 */
export const checkConsumptionAgainstAllocation = (input: {
  /** The run's allocated inventory item ids. Empty/absent = unconstrained. */
  allocatedInventoryItemIds: string[] | null | undefined
  inventoryItemId: string | null | undefined
  /** Titles/skus by item id, purely to make the refusal readable. */
  labelsById?: Record<string, string>
}): ConsumptionGateResult => {
  const allocated = (input.allocatedInventoryItemIds || []).filter(Boolean)
  if (!allocated.length) {
    return { allowed: true, constrained: false }
  }

  const itemId = input.inventoryItemId
  if (!itemId) {
    return {
      allowed: false,
      reason:
        "this run has an assigned material list, so consumption must name an inventory item",
    }
  }

  if (allocated.includes(itemId)) {
    return { allowed: true, constrained: true }
  }

  const labels = input.labelsById || {}
  const assigned = allocated.map((id) => labels[id] || id).join(", ")
  return {
    allowed: false,
    reason: `${labels[itemId] || itemId} is not assigned to this run. Assigned: ${assigned}.`,
  }
}

/**
 * May this run's allocation be edited, given it has already been accepted or
 * started? (#2111)
 *
 * The freeze exists for a real reason: the allocation is WHAT THE PARTNER WAS
 * SENT, and rewriting it after they accepted would change the terms of work
 * already under way. That reasoning covers taking material away. It does not
 * cover giving them more.
 *
 * The case that forced the distinction: we bought 2 Mill Spun Pashminas for a
 * tunic AFTER the run for that tunic had started. Under a flat freeze, cloth
 * bought for a run in progress can never be attached to it — and the
 * consignment gate keys on exactly that attachment, so the material could never
 * come off our books either. The run the goods were literally bought for was
 * the one run that could never record them.
 *
 * So: on a started run you may ADD an item and RAISE a quantity. You may not
 * remove an item, lower a quantity, or move where it is drawn from — each of
 * those retracts something the partner was already promised.
 *
 * 🔴 `planned_quantity: null` means "issued, amount not agreed" — NOT zero. So
 * null → a number is allowed (recording what was always true), while a number →
 * null is a retraction of the agreed figure and is refused.
 */
export type AllocationEditVerdict =
  | { allowed: true }
  | { allowed: false; reason: string }

export const checkAllocationEdit = (
  existing: NormalizedRunMaterial[],
  next: NormalizedRunMaterial[],
  runState: { accepted: boolean; label?: (id: string) => string }
): AllocationEditVerdict => {
  if (!runState.accepted) {
    return { allowed: true }
  }

  const name = (id: string) => runState.label?.(id) || id
  const byId = new Map(next.map((m) => [m.inventory_item_id, m]))

  for (const was of existing) {
    const now = byId.get(was.inventory_item_id)
    if (!now) {
      return {
        allowed: false,
        reason: `Cannot take ${name(
          was.inventory_item_id
        )} back off a run the partner has already accepted or started — you may add material to it, not remove it`,
      }
    }
    if (
      was.planned_quantity !== null &&
      (now.planned_quantity === null || now.planned_quantity < was.planned_quantity)
    ) {
      return {
        allowed: false,
        reason: `Cannot reduce ${name(was.inventory_item_id)} from ${
          was.planned_quantity
        } to ${
          now.planned_quantity ?? "unstated"
        } on a run the partner has already accepted or started`,
      }
    }
    if (was.location_id && now.location_id !== was.location_id) {
      return {
        allowed: false,
        reason: `Cannot move ${name(
          was.inventory_item_id
        )} from ${was.location_id} to ${
          now.location_id ?? "no location"
        } on a run the partner has already accepted or started — that changes where they were told to draw it from`,
      }
    }
  }

  return { allowed: true }
}
