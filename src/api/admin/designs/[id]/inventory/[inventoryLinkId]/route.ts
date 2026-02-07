
/**
 * PATCH /admin/designs/:id/inventory/:inventoryLinkId
 *
 * Update an inventory link for a design.
 *
 * This route updates attributes of the association between a design and an inventory entry
 * (identified by inventoryLinkId) and returns the refreshed design record. It validates the
 * incoming request body against AdminPatchDesignInventoryLinkReq, executes the
 * updateDesignInventoryLinkWorkflow in the current request scope, and refetches the design
 * using refetchDesign with the optional fields projection supplied via req.queryConfig.fields.
 *
 * Behavior:
 * - Expects path params:
 *   - id: design identifier
 *   - inventoryLinkId: inventory link identifier
 * - Accepts a validated body (AdminPatchDesignInventoryLinkReq) containing any of:
 *   - plannedQuantity?: number
 *   - locationId?: string
 *   - metadata?: Record<string, unknown>
 * - Calls updateDesignInventoryLinkWorkflow(req.scope).run({ input: { design_id, inventory_id, planned_quantity, location_id, metadata } }).
 * - If the workflow returns any errors, they are logged (console.warn) and thrown to produce an error response.
 * - On success, the design is re-fetched with refetchDesign(designId, req.scope, fields) and returned with HTTP 200.
 *
 * Notes:
 * - metadata is normalized to undefined if not provided.
 * - The request uses the framework's MedusaRequest and MedusaResponse types and runs within
 *   the request scope to access services/dependencies.
 * - The fields returned can be limited by passing queryConfig.fields (an array of allowed fields)
 *   in the request; by default, ["*"] is used to return all fields.
 *
 * @param req - MedusaRequest<AdminPatchDesignInventoryLinkReq>
 *   - req.params.id: string (design id)
 *   - req.params.inventoryLinkId: string (inventory link id)
 *   - req.validatedBody | req.body: { plannedQuantity?: number; locationId?: string; metadata?: Record<string, unknown> }
 *   - req.scope: service container used by workflows and refetch helper
 *   - req.queryConfig?.fields?: string[] (optional projection of response fields)
 *
 * @param res - MedusaResponse
 *   - On success: responds with status 200 and JSON body containing the refreshed design resource.
 *
 * @returns {Promise<void>} Sends a 200 response with the updated design on success.
 *
 * @throws Will re-throw workflow errors if updateDesignInventoryLinkWorkflow returns errors.
 *
 * @example
 * curl -X PATCH "https://api.example.com/admin/designs/abc123/inventory/inv456" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "plannedQuantity": 10,
 *     "locationId": "loc_789",
 *     "metadata": { "note": "restock for spring" }
 *   }'
 *
 * Successful response (200):
 * {
 *   "id": "abc123",
 *   "title": "My Design",
 *   "inventory_items": [
 *     {
 *       "id": "inv456",
 *       "planned_quantity": 10,
 *       "location_id": "loc_789",
 *       "metadata": { "note": "restock for spring" }
 *     },
 *     ...
 *   ],
 *   ...
 * }
 *
 * @example TypeScript (fetch)
 * const body = {
 *   plannedQuantity: 5,
 *   metadata: { launched: true }
 * };
 *
 * const res = await fetch(`/admin/designs/${designId}/inventory/${inventoryLinkId}`, {
 *   method: "PATCH",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "Authorization": `Bearer ${adminToken}`,
 *   },
 *   body: JSON.stringify(body),
 * });
 *
 * if (!res.ok) {
 *   // handle error (workflow errors are thrown by the route)
 * }
 * const updatedDesign = await res.json();
 *
 * @see updateDesignInventoryLinkWorkflow - performs the domain update for the inventory link
 * @see refetchDesign - reloads the design with an optional fields projection
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import { AdminPatchDesignInventoryLinkReq } from "../validators"
import { DesignInventoryAllowedFields, refetchDesign } from "../helpers"
import { updateDesignInventoryLinkWorkflow } from "../../../../../../workflows/designs/inventory/link-inventory"

export const PATCH = async (
  req: MedusaRequest<AdminPatchDesignInventoryLinkReq>,
  res: MedusaResponse,
) => {
  const designId = req.params.id
  const { inventoryLinkId } = req.params as { inventoryLinkId: string }
  const body = (req.validatedBody ?? req.body ?? {}) as AdminPatchDesignInventoryLinkReq
  const { plannedQuantity, locationId, metadata } = body

  const { errors } = await updateDesignInventoryLinkWorkflow(req.scope).run({
    input: {
      design_id: designId,
      inventory_id: inventoryLinkId,
      planned_quantity: plannedQuantity,
      location_id: locationId,
      metadata: metadata ?? undefined,
    },
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors)
    throw errors
  }

  const design = await refetchDesign(
    designId,
    req.scope,
    (req.queryConfig?.fields as DesignInventoryAllowedFields[]) || ["*"],
  )

  res.status(200).json(design)
}
