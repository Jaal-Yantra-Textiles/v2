import type {
  CreateShipmentInput,
  Dimensions,
} from "../../../modules/shipping-providers/provider-interface"

/**
 * Pure mapping from a production run onto a carrier `CreateShipmentInput` for a
 * location→location goods transfer (#891).
 *
 * The run analogue of `buildInventoryOrderShipmentInput`. The difference that
 * matters is what's in the box: an inventory order ships PROCURED materials
 * described by its order lines, while a transfer ships the run's OUTPUT — one
 * kind of finished good, at the produced quantity. There are no lines to walk,
 * so the manifest is a single item derived from the run.
 *
 * Both ends are stock locations. The destination address is resolved by the
 * caller (reusing `resolveInventoryDestinationAddress`, which already knows how
 * to build a carrier-acceptable address out of a stock location) and the origin
 * is a registered carrier pickup referenced by `pickupLocationName` — Shiprocket
 * derives the origin address from the pickup, never from the payload.
 *
 * Always prepaid: nobody collects cash for moving our own goods between our own
 * locations. `sub_total` is a DECLARED value for the manifest, not a sale.
 *
 * Pure & exported for unit testing.
 */

export const DEFAULT_TRANSFER_WEIGHT_GRAMS = 500

export type RunForTransfer = {
  id: string
  design_id?: string | null
  quantity?: number | null
  produced_quantity?: number | null
  /** Run snapshot — the only place a human-readable design title is kept. */
  snapshot?: Record<string, any> | null
  /** Partner's agreed cost for the run; the declared value of the goods. */
  partner_cost_estimate?: number | null
  cost_type?: string | null
  metadata?: Record<string, any> | null
}

export type BuildTransferShipmentOpts = {
  /** Registered carrier pickup nickname (exact match). "" → client default. */
  pickupLocationName?: string
  /** Resolved destination address (see `resolveInventoryDestinationAddress`). */
  destinationAddress: Record<string, any>
  /** Units moving in THIS hop — may be less than the run produced. */
  quantity?: number
  weightGrams?: number
  dimensionsCm?: Dimensions
  preferredCourierId?: string | number
  /** Seller tax/GST ID to stamp on the label (#348); resolved by the caller. */
  taxId?: string
  /**
   * Distinguishes this hop's carrier reference from every other hop of the same
   * run. `create/adhoc` DEDUPES on the channel order id, so two hops sharing a
   * reference would resolve to one carrier order and the second would assign
   * against the first one's shipment (#1225). One reference per transfer row.
   */
  transferId?: string
}

/**
 * What the run produced, as a manifest line. Falls back through the snapshot
 * because a run carries no title column of its own.
 */
export function describeRunOutput(run: RunForTransfer): string {
  const snap = run.snapshot || {}
  const title =
    snap.design_name ||
    snap.design_title ||
    snap.title ||
    snap.name ||
    (run.metadata || {}).title
  return String(title || "Finished goods")
}

/**
 * Units in this hop: an explicit quantity → what the run actually produced →
 * what it was asked to produce. `produced_quantity` wins over `quantity`
 * because a run that made 8 of 10 moves 8 boxes, not 10.
 */
export function transferQuantity(
  run: RunForTransfer,
  requested?: number
): number {
  const explicit = Number(requested)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const produced = Number(run.produced_quantity)
  if (Number.isFinite(produced) && produced > 0) return produced
  const ordered = Number(run.quantity)
  return Number.isFinite(ordered) && ordered > 0 ? ordered : 1
}

/**
 * Declared per-unit value of the goods. The run's partner cost is what the
 * goods are demonstrably worth at this point in their life — it's what we
 * agreed to pay to bring them into existence. `cost_type: "total"` means the
 * estimate covers the whole run, so it has to be divided down to a unit price
 * or the manifest declares the run's value once per unit.
 */
export function transferUnitValue(
  run: RunForTransfer,
  quantity: number
): number {
  const cost = Number(run.partner_cost_estimate)
  if (!Number.isFinite(cost) || cost <= 0) return 0
  if (run.cost_type === "per_unit") return cost
  const units = Number(run.quantity) || quantity || 1
  return units > 0 ? cost / units : cost
}

export function buildTransferShipmentInput(
  run: RunForTransfer,
  opts: BuildTransferShipmentOpts
): CreateShipmentInput {
  const addr = opts.destinationAddress || {}
  const quantity = transferQuantity(run, opts.quantity)
  const unitPrice = transferUnitValue(run, quantity)

  const name =
    [addr.first_name, addr.last_name].filter(Boolean).join(" ") || "Warehouse"

  return {
    // One carrier reference per HOP, not per run — see `transferId` above.
    reference_id: opts.transferId || run.id,
    // A transfer between our own locations is never collected on delivery.
    payment_mode: "prepaid",
    pickup_location_name: opts.pickupLocationName || "",
    to: {
      name,
      phone: addr.phone || "",
      email: addr.email || undefined,
      address_1: addr.address_1 || "",
      address_2: addr.address_2 || undefined,
      city: addr.city || "",
      state: addr.province || addr.state || "",
      pincode: addr.postal_code || "",
      country: addr.country_code ? String(addr.country_code).toUpperCase() : "IN",
    },
    items: [
      {
        name: describeRunOutput(run),
        sku: run.design_id ? String(run.design_id) : undefined,
        quantity,
        unit_price: unitPrice,
      },
    ],
    weight_grams: opts.weightGrams || DEFAULT_TRANSFER_WEIGHT_GRAMS,
    dimensions_cm: opts.dimensionsCm,
    sub_total: unitPrice * quantity,
    preferred_courier_id: opts.preferredCourierId,
    tax_id: opts.taxId,
  }
}
