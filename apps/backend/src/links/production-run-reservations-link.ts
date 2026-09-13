import { defineLink } from "@medusajs/framework/utils"
import InventoryModule from "@medusajs/medusa/inventory"
import ProductionRunsModule from "../modules/production_runs"

/**
 * Link a production run to the reservations it holds (#2029 item 3).
 *
 * 🔴 Which reservations belong to a run decides where physical stock ends up.
 * `repointReservations` (`receive-goods-transfer.ts`) moves them to follow the
 * goods on a transfer receipt — leave one behind and the origin owes a unit it
 * no longer has while the destination holds one nothing has claimed.
 *
 * That fact lived only in `reservation.metadata.production_run_id`, which is
 * why the reader had to list every reservation at the location and filter
 * in-app: JSON cannot be filtered in the query. The reader's own comment said
 * so. This gives it a typed home so the question can be ASKED instead of
 * scanned for.
 *
 * ⚠️ EXPORTED, and that matters — see `partner-stores-link.ts`. `defineLink`
 * registers as an import side effect, so a link works without an export, but
 * nothing can then reach its `entryPoint`, which is the only safe way to READ
 * it. And a `query.graph` hop that names the wrong thing comes back with no key
 * rather than an error, so an empty result is indistinguishable from "this run
 * holds no reservations" — the exact ambiguity this link is meant to remove.
 */
export default defineLink(
  ProductionRunsModule.linkable.productionRuns,
  { linkable: InventoryModule.linkable.reservationItem, isList: true }
)
