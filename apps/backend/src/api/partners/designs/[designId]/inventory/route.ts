/**
 * @file Partner design ↔ inventory (bill-of-materials) routes
 * @description Roadmap #6 Phase 2 — lets a partner link GLOBAL
 * inventory items to their OWN design as a bill-of-materials, with a
 * planned quantity per item. Mirrors the admin
 * `/admin/designs/:id/inventory` contract; scoping (design ownership +
 * location) is enforced in the handler.
 *
 * Supersedes the previously-deprecated (410) consumption-report POST —
 * consumption reporting now lives on
 * `POST /partners/designs/:id/complete`.
 *
 * @module API/Partners/Designs/Inventory
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework"
import { MedusaError } from "@medusajs/framework/utils"
import { linkDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/link-inventory"
import { listDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/list-design-inventory"
import { assertPartnerOwnsDesign, getPartnerPrimaryStore } from "../../helpers"
import { PartnerPostDesignInventoryReq } from "./validators"

/**
 * Link global inventory items to a partner-owned design (BOM).
 * @route POST /partners/designs/:designId/inventory
 */
export async function POST(
  req: AuthenticatedMedusaRequest<PartnerPostDesignInventoryReq> & {
    params: { designId: string }
  },
  res: MedusaResponse
) {
  const { designId } = req.params
  const { partner } = await assertPartnerOwnsDesign(req, designId)

  // Scope any location the partner pins to their own warehouse. Default
  // to the store's default location when omitted. A partner must not be
  // able to pin a BOM line to a location they don't own.
  const store = await getPartnerPrimaryStore(req, partner.id)
  const defaultLocationId: string | undefined =
    store?.default_location_id ?? undefined

  const body = req.validatedBody
  const scopeLocation = (locationId?: string): string | undefined => {
    const loc = locationId ?? defaultLocationId
    if (loc && defaultLocationId && loc !== defaultLocationId) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        `location_id ${loc} is not this partner's warehouse`
      )
    }
    return loc
  }

  const inventoryItems = (body.inventoryItems ?? []).map((item) => ({
    inventory_id: item.inventoryId,
    planned_quantity: item.plannedQuantity,
    location_id: scopeLocation(item.locationId),
    metadata: item.metadata,
  }))

  // Bare inventoryIds inherit the partner's default location.
  const inventoryItemsFromIds = (body.inventoryIds ?? []).map((id) => ({
    inventory_id: id,
    location_id: defaultLocationId,
  }))

  const { errors } = await linkDesignInventoryWorkflow(req.scope).run({
    input: {
      design_id: designId,
      inventory_items: [...inventoryItems, ...inventoryItemsFromIds],
    },
  })
  if (errors.length > 0) {
    throw errors
  }

  const { result } = await listDesignInventoryWorkflow(req.scope).run({
    input: { design_id: designId },
  })
  res.status(201).json(result)
}

/**
 * List the design's linked inventory (BOM). Readable by the owning
 * partner; non-owners who aren't linked are blocked by the ownership
 * guard (NOT_ALLOWED).
 * @route GET /partners/designs/:designId/inventory
 */
export async function GET(
  req: AuthenticatedMedusaRequest & { params: { designId: string } },
  res: MedusaResponse
) {
  const { designId } = req.params
  await assertPartnerOwnsDesign(req, designId)

  const { result } = await listDesignInventoryWorkflow(req.scope).run({
    input: { design_id: designId },
  })
  res.status(200).json(result)
}
