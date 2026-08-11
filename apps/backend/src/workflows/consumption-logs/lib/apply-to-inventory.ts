import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

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
    // Where this log draws from: the design↔inventory link's location when it
    // has one, else the brand default.
    const locationId =
      input.locationByLog?.[log.id] ?? input.brandLocationId

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
