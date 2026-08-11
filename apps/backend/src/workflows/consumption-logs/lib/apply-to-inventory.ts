import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { LOCATION_OWNERSHIP_MODULE } from "../../../modules/location_ownership"

/**
 * Turning committed consumption into an inventory movement — the shared rule.
 *
 * Committing a consumption log deliberately does NOT move stock (see the
 * docblock on `propagateCostsStep` in ../commit-consumption.ts): partners burn
 * fabric we never owned, and their reported consumption should move cost, not
 * inventory. That is a boundary, not an oversight.
 *
 * The bug is that the boundary was drawn as "never", when it should be "not
 * theirs". Material issued from OUR OWN warehouse is a real stock movement and
 * has never been recorded — 63 committed logs on prod moved zero stock.
 *
 * So every deduction is gated on the brand store's own location. Partner-held
 * consumption keeps behaving exactly as it does today, by construction.
 */

/** A `Hour`/`kWh` labour or energy log carries raw_material_id, not an item. */
export type ConsumptionApplyLog = {
  id: string
  design_id: string | null
  production_run_id?: string | null
  quantity_basis?: "total" | "per_piece" | null
  inventory_item_id: string | null
  quantity: number | string | null
  is_committed: boolean
  location_id: string | null
  metadata: Record<string, any> | null
}

export type ConsumptionApplyPlanInput = {
  /** Default location stock is deducted from, when a log resolves no other. */
  brandLocationId: string
  logs: ConsumptionApplyLog[]
  /**
   * Stocked quantity at the brand location, keyed by inventory_item_id. A key
   * being ABSENT means the item has no level there at all — which is the signal
   * that the material was never ours.
   */
  brandLevels: Record<string, number>
  /**
   * The location a given log actually draws from, keyed by log id — the design↔
   * inventory link's `location_id` ("Preferred location" in the admin drawer).
   *
   * That field has always been rendered next to planned/consumed, implying it
   * decides where the material comes from, while nothing read it: every
   * deduction went to the one brand-store default. Honouring it here is what
   * makes the UI's promise true, and gives per-design control instead of a
   * single global default. A log with no entry falls back to `brandLocationId`,
   * which is the previous behaviour exactly.
   */
  locationByLog?: Record<string, string>
  /**
   * Stocked quantities at any NON-brand location a log resolves to, keyed
   * `${inventory_item_id}@${location_id}`. Merged over `brandLevels` into one
   * running balance, so several logs drawing on the same item at the same
   * location share it — and the same item at two locations does not.
   */
  levelsAtLocation?: Record<string, number>
  /**
   * The locations we own. A log resolving anywhere else is skipped outright —
   * this is the ownership boundary stated as a rule instead of emerging from
   * "the item happens to have no level at the one brand location". Omit to
   * skip the check (callers that have already constrained the locations).
   */
  coreLocationIds?: Set<string>
  /**
   * Refuse any deduction whose shortfall would exceed this, skipping the log
   * instead of applying it.
   *
   * A shortfall means the level held less than the log claimed, so the applied
   * movement is smaller than the reported consumption — and the log is then
   * STAMPED `inventory_applied_at` and skipped forever after. When the stock
   * simply hasn't arrived yet (a mis-routed inventory order, an un-received
   * delivery), that stamp burns the log against a balance it was never measured
   * against, and no later repair can re-apply it. Undefined keeps the previous
   * behaviour of applying regardless.
   */
  maxShortfall?: number
  /**
   * Finished pieces the log's quantity should be multiplied by, keyed by log id.
   *
   * A logged quantity is PER PIECE: a partner reporting 2.15 m against a run of
   * 2 consumed 4.3 m. The column is read as a total everywhere else (cost is
   * `quantity × unit_cost`), so the multiplication belongs here, at the point
   * stock actually moves, and is reported explicitly on every decision.
   *
   * A log absent from this map, or mapped to 0, CANNOT be resolved — the piece
   * count is unknown — and is skipped rather than deducted at face value.
   * Omitting the map entirely keeps the old 1:1 behaviour.
   */
  piecesByLog?: Record<string, number>
  /**
   * Basis to assume for logs written before the capture forms recorded one
   * (`quantity_basis: null`). Undefined means refuse to guess: those logs skip.
   */
  assumeBasisWhenUnknown?: "total" | "per_piece"
}

export type ConsumptionApplyDecision =
  | {
      action: "apply"
      log_id: string
      inventory_item_id: string
      /** The location this deduction lands on, once the link override applies. */
      location_id: string
      /** The RESOLVED total actually deducted (per_piece × pieces when known). */
      quantity: number
      before: number
      after: number
      /** The figure as logged, when it was resolved as a per-piece rate. */
      per_piece?: number
      /** Finished pieces the per-piece figure was multiplied by. */
      pieces?: number
      /** Set when the log wanted more than the level held. */
      shortfall?: number
    }
  | { action: "skip"; log_id: string; reason: string }

export const APPLIED_AT_KEY = "inventory_applied_at"
export const APPLIED_LOCATION_KEY = "inventory_applied_location_id"

/**
 * Key for one stocked balance. Exported so the job seeds `levelsAtLocation`
 * with exactly the keys the planner looks up — a mismatch here would read as
 * "no level at that location" and silently skip every affected log.
 */
export const levelKey = (inventoryItemId: string, locationId: string): string =>
  `${inventoryItemId}@${locationId}`

/**
 * Quantities here are decimal metres, so binary float noise is guaranteed:
 * `17.6 - 2.15` is `15.450000000000001`. That would be written straight to
 * `stocked_quantity` and then compound on the next deduction. Six places is far
 * beyond any real fabric measurement and well inside float precision.
 */
const round = (n: number): number => Number(n.toFixed(6))

/**
 * PURE: where each material actually sits, from its own stock levels.
 *
 * This is the honest source of truth for a deduction. The design↔inventory
 * link's "Preferred location" is an override an operator has to remember to
 * set, and in practice never is — all nine designs carrying an unsettled
 * material log on prod have it null. The material itself always knows: a log
 * against `5210-MUSLIN-100S` should come off Dharamshala because that is where
 * the muslin is, not because anyone configured a design.
 *
 * Only levels holding stock count, and that single rule carries the ownership
 * boundary that used to need the brand-store lookup:
 *
 *   - exactly one location holds stock → that is where it came from
 *   - NO location holds stock → we do not have this material; partner-held, and
 *     left unresolved so the caller's fallback skips it
 *   - more than one → genuinely ambiguous, left unresolved rather than guessed
 *
 * Denim Trouser is the case that proves the first rule earns its keep: it has
 * levels at two locations, and only Dharamshala holds any (Shramdaan is 0), so
 * it resolves without a tiebreak.
 */
export function resolveLocationsFromLevels(
  levels: Array<{
    inventory_item_id: string
    location_id: string
    stocked_quantity: number | string | null
  }>,
  /**
   * The locations we own. Levels anywhere else are ignored outright — a
   * material sitting in a partner's warehouse must never resolve as the place
   * to deduct from, however unambiguously it sits there. Omit to consider every
   * location (callers that have already filtered).
   */
  coreLocationIds?: Set<string>
): Record<string, string> {
  const stockedByItem = new Map<string, string[]>()
  for (const lv of levels) {
    if (!lv?.inventory_item_id || !lv.location_id) {
      continue
    }
    if (coreLocationIds && !coreLocationIds.has(lv.location_id)) {
      continue
    }
    if (Number(lv.stocked_quantity ?? 0) > 0) {
      const list = stockedByItem.get(lv.inventory_item_id) ?? []
      list.push(lv.location_id)
      stockedByItem.set(lv.inventory_item_id, list)
    }
  }

  const out: Record<string, string> = {}
  for (const [itemId, locations] of stockedByItem) {
    if (locations.length === 1) {
      out[itemId] = locations[0]
    }
  }
  return out
}

/**
 * PURE: decide what each log does. Exported for unit tests.
 *
 * Logs are processed in id order and the level is carried forward between them,
 * so several logs against one item draw down a shared running balance rather
 * than each measuring against the original stock.
 *
 * Never goes negative: a log wanting more than is held floors the level at 0 and
 * reports the `shortfall`. A negative level is not more honest here — the stock
 * genuinely left the building, and the discrepancy is in the paperwork, which
 * the shortfall is what surfaces.
 */
export function planConsumptionApplication(
  input: ConsumptionApplyPlanInput
): ConsumptionApplyDecision[] {
  // One balance map keyed item@location. Keying by item alone would let the
  // same material at two locations share a balance once per-design locations
  // exist, which is how a double-deduction would get in.
  const running: Record<string, number> = {}
  for (const [itemId, qty] of Object.entries(input.brandLevels ?? {})) {
    running[levelKey(itemId, input.brandLocationId)] = qty
  }
  Object.assign(running, input.levelsAtLocation ?? {})

  const decisions: ConsumptionApplyDecision[] = []

  const ordered = [...input.logs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const log of ordered) {
    const skip = (reason: string) =>
      decisions.push({ action: "skip", log_id: log.id, reason })

    if (!log.is_committed) {
      skip("not committed")
      continue
    }
    if (log.metadata?.[APPLIED_AT_KEY]) {
      skip(`already applied at ${log.metadata[APPLIED_AT_KEY]}`)
      continue
    }
    // Labour (`Hour`) and energy (`kWh`) logs carry a raw_material_id instead —
    // 1300 units of them on prod. Deducting those would be nonsense.
    if (!log.inventory_item_id) {
      skip("no inventory_item_id (labour/energy log)")
      continue
    }
    // Where this log draws from: whatever the caller resolved for it, else the
    // brand default. Empty means nothing could place it at all.
    const locationId =
      input.locationByLog?.[log.id] || input.brandLocationId
    if (!locationId) {
      skip(
        "no location could be resolved — the material is stocked at none of our locations, and no brand default was determinable"
      )
      continue
    }

    // A log carrying its own location is taken at its word, and a log recorded
    // somewhere other than where this design draws from is NOT ours to deduct.
    // This is the check that protects partner-held material: without it, a log
    // stamped with a partner's warehouse would silently deduct from ours.
    if (log.location_id && log.location_id !== locationId) {
      skip(
        `logged at ${log.location_id}, which is not where this design draws stock from (${locationId})`
      )
      continue
    }
    // The ownership rule, stated outright: material drawn from a location we
    // do not own is not ours to move, whatever its stock says.
    if (input.coreLocationIds && !input.coreLocationIds.has(locationId)) {
      skip(`${locationId} is not one of our locations (partner-held)`)
      continue
    }
    const key = levelKey(log.inventory_item_id, locationId)
    if (!(key in running)) {
      skip(`item has no stock level at ${locationId} (partner-held)`)
      continue
    }

    const perPiece = Number(log.quantity ?? 0)
    if (!Number.isFinite(perPiece) || perPiece <= 0) {
      skip(`non-positive quantity (${log.quantity})`)
      continue
    }

    // What the figure measures decides whether it is multiplied at all. A null
    // basis predates the forms asking, so it is resolved only against an
    // explicit assumption — never defaulted.
    const basis = log.quantity_basis ?? input.assumeBasisWhenUnknown
    if (!basis) {
      skip(
        "quantity_basis unknown (logged before the form recorded it) — pass assume_basis to resolve"
      )
      continue
    }

    let quantity = perPiece
    let pieces: number | undefined
    if (basis === "per_piece") {
      pieces = input.piecesByLog?.[log.id]
      if (!pieces || pieces <= 0) {
        skip(
          "piece count unknown (no completed production run for this design) — cannot resolve a per-piece quantity"
        )
        continue
      }
      quantity = round(perPiece * pieces)
    }

    const before = running[key]
    const after = round(Math.max(0, before - quantity))
    const shortfall = round(quantity - (before - after))

    if (input.maxShortfall != null && shortfall > input.maxShortfall) {
      skip(
        `shortfall ${shortfall} exceeds max_shortfall ${input.maxShortfall} (level ${before} < logged ${quantity}) — stock likely not received yet`
      )
      continue
    }

    running[key] = after
    decisions.push({
      action: "apply",
      log_id: log.id,
      inventory_item_id: log.inventory_item_id,
      location_id: locationId,
      quantity,
      before,
      after,
      ...(pieces != null ? { per_piece: perPiece, pieces } : {}),
      ...(shortfall > 0 ? { shortfall } : {}),
    })
  }

  return decisions
}

/**
 * The locations we own, and may deduct consumption from.
 *
 * Read from `location_ownership` rather than inferred: ownership decides
 * whether stock moves at all, and the old inference (the one store no partner
 * links to, then its default location) cannot express several warehouses and
 * breaks on an orphan store.
 *
 * PRE-SEED FALLBACK: with no rows recorded yet, an empty set would make every
 * location non-core and quietly turn the job into a no-op that reports nothing
 * wrong. So an empty table falls back to the previously-inferred brand default
 * — exactly the old behaviour — and the caller says so in its summary. Once a
 * single row exists the table is authoritative and no inference happens.
 */
export async function resolveCoreLocationIds(
  container: MedusaContainer
): Promise<{ coreLocationIds: Set<string>; seeded: boolean }> {
  const service: any = container.resolve(LOCATION_OWNERSHIP_MODULE)
  const rows = await service.listLocationOwnerships({}, { take: null })

  if (!rows?.length) {
    const brandLocationId = await resolveBrandLocationId(container)
    return { coreLocationIds: new Set([brandLocationId]), seeded: false }
  }

  return {
    coreLocationIds: new Set(
      (rows as any[])
        .filter((r) => r.is_core && r.stock_location_id)
        .map((r) => r.stock_location_id as string)
    ),
    seeded: true,
  }
}

/**
 * The brand store is the one store NOT reachable from any partner.
 *
 * There is no ownership flag on a store or a location, and matching on name is
 * a trap: prod carries legacy duplicates named after partners (`Shramdaan` vs
 * the partner's `Shramdaan India Warehouse`). Partner stores are reachable
 * through the partner↔store link, so the brand store is what's left over.
 */
export async function resolveBrandLocationId(
  container: MedusaContainer
): Promise<string> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["id", "stores.id"],
  })
  const partnerStoreIds = new Set<string>()
  for (const p of (partners || []) as any[]) {
    for (const s of (p?.stores || []) as any[]) {
      if (s?.id) {
        partnerStoreIds.add(s.id)
      }
    }
  }

  const { data: stores } = await query.graph({
    entity: "stores",
    fields: ["id", "name", "default_location_id"],
  })
  const brandStores = ((stores || []) as any[]).filter(
    (s) => s?.id && !partnerStoreIds.has(s.id)
  )

  if (brandStores.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Expected exactly one non-partner (brand) store, found ${brandStores.length} — pass location_id explicitly`
    )
  }
  const locationId = brandStores[0].default_location_id
  if (!locationId) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Brand store ${brandStores[0].id} has no default_location_id — pass location_id explicitly`
    )
  }
  return locationId as string
}
