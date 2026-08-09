/**
 * Delhivery warehouse (pickup point) registration for a stock location.
 *
 * The Delhivery twin of `registerShiprocketPickup` (`./pickup-locations.ts`),
 * and the fix for the defect behind order #83: `POST /api/cmu/create.json`
 * refuses every manifest whose `pickup_location.name` is not a registered
 * warehouse, with `ClientWarehouse matching query does not exist.` Nothing
 * registered warehouses outside of store creation, so **no** existing stock
 * location had one, and every admin Delhivery fulfillment failed.
 *
 * Three Delhivery rules shape this file (per their Express API docs):
 *   1. A warehouse must exist BEFORE an order can reference it.
 *   2. Warehouse names are UNIQUE per account.
 *   3. The name sent at order creation must match EXACTLY, case-sensitively.
 *
 * `delhiveryWarehouseNameForLocation` satisfies all three, and — crucially —
 * is derived from the location id alone, so the fulfillment provider computes
 * the same name without being able to read this metadata.
 *
 * Unlike Shiprocket, Delhivery's Express API exposes **no way to list**
 * warehouses, so "is it registered?" is answered by the recorded metadata key,
 * and re-registration is made safe by treating a duplicate-name rejection as
 * success rather than by looking first.
 */
import { MedusaContainer } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import { resolveShippingProvider } from "./resolver"
import {
  DELHIVERY_WAREHOUSE_METADATA_KEY,
  delhiveryWarehouseNameForLocation,
} from "./delhivery/warehouse-name"

export { DELHIVERY_WAREHOUSE_METADATA_KEY, delhiveryWarehouseNameForLocation }

export type DelhiveryWarehouseResult = {
  /** The warehouse name now recorded on the stock location. */
  name: string
  /** True when Delhivery already held a warehouse under this name. */
  already_existed: boolean
}

type StockLocationRow = {
  id: string
  name?: string
  metadata?: Record<string, any> | null
  address?: {
    phone?: string
    address_1?: string
    address_2?: string
    city?: string
    province?: string
    postal_code?: string
    country_code?: string
  } | null
}

async function loadStockLocation(
  container: MedusaContainer,
  locationId: string
): Promise<StockLocationRow> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name", "metadata", "address.*"],
    filters: { id: locationId },
  })
  const loc = (data as any)?.[0]
  if (!loc) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Stock location ${locationId} not found`
    )
  }
  return loc as StockLocationRow
}

/**
 * Register (or confirm) a stock location as a Delhivery warehouse and record the
 * name on `stock_location.metadata`. Idempotent — safe to re-run.
 *
 * `opts.email` is the contact recorded on the warehouse (routes pass the acting
 * user's email).
 */
export async function registerDelhiveryWarehouse(
  container: MedusaContainer,
  locationId: string,
  opts?: { email?: string }
): Promise<DelhiveryWarehouseResult> {
  const loc = await loadStockLocation(container, locationId)
  const existingName = (loc.metadata as any)?.[
    DELHIVERY_WAREHOUSE_METADATA_KEY
  ] as string | undefined
  const name = existingName || delhiveryWarehouseNameForLocation(locationId)!

  const addr = loc.address || {}
  // Delhivery rejects an incomplete warehouse, and the rejection is opaque —
  // fail here with the missing fields named instead.
  const missing = [
    !addr.phone ? "phone" : null,
    !addr.postal_code ? "postal code" : null,
    !addr.address_1 ? "address line 1" : null,
    !addr.city ? "city" : null,
  ].filter(Boolean) as string[]
  if (missing.length) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Stock location "${loc.name || locationId}" is missing the ${missing.join(
        ", "
      )} required to register a Delhivery warehouse (would register as "${name}"). ` +
        `If it is already registered with Delhivery under a different name, record that exact name ` +
        `in the location's metadata key "${DELHIVERY_WAREHOUSE_METADATA_KEY}" instead — Delhivery matches it case-sensitively.`
    )
  }

  const provider = await resolveShippingProvider(container, "delhivery")
  if (!provider.registerPickupLocation) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Delhivery provider does not support warehouse registration"
    )
  }

  let alreadyExisted = false
  try {
    await provider.registerPickupLocation({
      name,
      phone: addr.phone!,
      email: opts?.email,
      address_1: addr.address_1 || "",
      address_2: addr.address_2 || "",
      city: addr.city || "",
      state: addr.province || "",
      pincode: addr.postal_code!,
      country: "India",
    })
  } catch (e: any) {
    // Names are unique per account, so a duplicate means it is already there —
    // which is the state we wanted. Delhivery has no list endpoint to check
    // first, so this rejection IS the idempotency check.
    if (/already|exist|duplicate/i.test(String(e?.message || ""))) {
      alreadyExisted = true
    } else {
      throw e
    }
  }

  await persistWarehouseName(container, loc, name)

  return { name, already_existed: alreadyExisted }
}

/** Persist the Delhivery warehouse name onto a stock location's metadata. */
async function persistWarehouseName(
  container: MedusaContainer,
  loc: StockLocationRow,
  name: string
): Promise<void> {
  if ((loc.metadata as any)?.[DELHIVERY_WAREHOUSE_METADATA_KEY] === name) {
    return
  }
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION) as any
  await stockLocationService.updateStockLocations(loc.id, {
    metadata: {
      ...(loc.metadata || {}),
      [DELHIVERY_WAREHOUSE_METADATA_KEY]: name,
    },
  })
}

/**
 * What we know about a location's Delhivery registration, without side effects.
 *
 * Delhivery cannot be queried for this — there is no list-warehouses endpoint —
 * so a recorded name is the only evidence available, and `null` means "never
 * registered through us", not "definitely absent at Delhivery".
 */
export async function getDelhiveryWarehouseStatus(
  container: MedusaContainer,
  locationId: string
): Promise<DelhiveryWarehouseResult | null> {
  const loc = await loadStockLocation(container, locationId)
  const name = (loc.metadata as any)?.[DELHIVERY_WAREHOUSE_METADATA_KEY] as
    | string
    | undefined
  if (!name) return null
  return { name, already_existed: true }
}
