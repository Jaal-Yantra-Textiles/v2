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
  inventory_item_id: string | null
  quantity: number | string | null
  is_committed: boolean
  location_id: string | null
  metadata: Record<string, any> | null
}

export type ConsumptionApplyPlanInput = {
  /** The only location stock may be deducted from. */
  brandLocationId: string
  logs: ConsumptionApplyLog[]
  /**
   * Stocked quantity at the brand location, keyed by inventory_item_id. A key
   * being ABSENT means the item has no level there at all — which is the signal
   * that the material was never ours.
   */
  brandLevels: Record<string, number>
}

export type ConsumptionApplyDecision =
  | {
      action: "apply"
      log_id: string
      inventory_item_id: string
      quantity: number
      before: number
      after: number
      /** Set when the log wanted more than the level held. */
      shortfall?: number
    }
  | { action: "skip"; log_id: string; reason: string }

export const APPLIED_AT_KEY = "inventory_applied_at"
export const APPLIED_LOCATION_KEY = "inventory_applied_location_id"

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
  const running: Record<string, number> = { ...input.brandLevels }
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
    // An explicitly-located log is taken at its word.
    if (log.location_id && log.location_id !== input.brandLocationId) {
      skip(`logged at a non-brand location (${log.location_id})`)
      continue
    }
    if (!(log.inventory_item_id in running)) {
      skip("item has no stock level at the brand location (partner-held)")
      continue
    }

    const quantity = Number(log.quantity ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      skip(`non-positive quantity (${log.quantity})`)
      continue
    }

    const before = running[log.inventory_item_id]
    const after = round(Math.max(0, before - quantity))
    const shortfall = round(quantity - (before - after))

    running[log.inventory_item_id] = after
    decisions.push({
      action: "apply",
      log_id: log.id,
      inventory_item_id: log.inventory_item_id,
      quantity,
      before,
      after,
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
