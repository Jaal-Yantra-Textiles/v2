/**
 * GET /partners/inventory-items/raw-materials
 *
 * Lists raw-material inventory items (admin-maintained, shared) so a
 * partner can pick them into a design's bill-of-materials. Unlike
 * `GET /partners/inventory-items` — which is scoped to stock levels at
 * the partner's own location and therefore hides admin raw materials —
 * this returns the global raw-material catalog with media, mirroring
 * `GET /admin/inventory-items/raw-materials`.
 *
 * Query: limit?, offset?, q? (search across raw material name / item
 * title / sku).
 *
 * Response: { inventory_items, count, offset, limit }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import {
  getAllInventoryWithRawMaterial,
  RawMaterialAllowedFields,
} from "../../../admin/inventory-items/[id]/rawmaterials/helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const qv = (req.validatedQuery ?? req.query ?? {}) as Record<string, any>
  const limit = Number(qv.limit ?? 20)
  const offset = Number(qv.offset ?? 0)
  const filters = {
    ...(qv.q ? { q: qv.q } : {}),
  } as Record<string, unknown>

  const all = await getAllInventoryWithRawMaterial(
    req.scope,
    filters,
    ["*"] as RawMaterialAllowedFields[]
  )

  const count = all.length
  const paginated = all.slice(offset, offset + limit)

  res.status(200).json({
    inventory_items: paginated,
    count,
    offset,
    limit,
  })
}
