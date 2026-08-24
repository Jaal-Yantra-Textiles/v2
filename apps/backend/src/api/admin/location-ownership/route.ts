import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { LOCATION_OWNERSHIP_MODULE } from "../../../modules/location_ownership"
import { AdminPostLocationOwnershipReq } from "./validators"

/**
 * GET /admin/location-ownership
 *
 * Every recorded location ownership. Small by nature — one row per stock
 * location — so it returns the lot rather than paginating.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: any = req.scope.resolve(LOCATION_OWNERSHIP_MODULE)
  const rows = await service.listLocationOwnerships({}, { take: null })

  res.json({ location_ownership: rows ?? [] })
}

/**
 * POST /admin/location-ownership
 *
 * Upsert one location's ownership. Whether a location is ours decides whether
 * consumption may be deducted from it at all, so this writes an explicit row
 * rather than toggling anything inferred.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { stock_location_id, is_core, is_export_origin, note } =
    req.validatedBody as AdminPostLocationOwnershipReq

  const service: any = req.scope.resolve(LOCATION_OWNERSHIP_MODULE)
  const [existing] = await service.listLocationOwnerships(
    { stock_location_id },
    { take: 1 }
  )

  const row = existing
    ? await service.updateLocationOwnerships({
        id: existing.id,
        is_core,
        // Omitted means "leave the stored answer alone"; an explicit null
        // clears it back to undecided. See the validator.
        ...(is_export_origin !== undefined ? { is_export_origin } : {}),
        ...(note !== undefined ? { note } : {}),
      })
    : await service.createLocationOwnerships({
        stock_location_id,
        is_core,
        is_export_origin: is_export_origin ?? null,
        note: note ?? null,
      })

  res.json({ location_ownership: row })
}
