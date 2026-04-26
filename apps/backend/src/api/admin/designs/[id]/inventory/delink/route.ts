
/**
 * POST /admin/designs/:id/inventory/delink
 *
 * Removes (delinks) one or more inventory items from a design.
 *
 * The handler:
 * - Reads the design id from req.params.id.
 * - Expects a validated request body (AdminDeleteDesignInventoryReq) containing `inventoryIds`.
 * - Calls the delinkDesignInventoryWorkflow to perform the delink operation.
 * - If the workflow reports errors, the handler throws them.
 * - Refetches the updated design (honoring optional req.queryConfig.fields) and responds with the design JSON.
 *
 * @param req - MedusaRequest<AdminDeleteDesignInventoryReq> containing:
 *   - params.id: the design id to update
 *   - validatedBody.inventoryIds: array of inventory ids to delink
 *   - optional queryConfig.fields to limit returned fields
 * @param res - MedusaResponse used to send the updated design with status 200
 *
 * @returns Promise<void> Responds with the updated design object (HTTP 200) on success.
 *
 * @throws If the delinkDesignInventoryWorkflow returns any errors, those errors are thrown.
 *
 * @example
 * curl -X POST "https://api.example.com/admin/designs/design_123/inventory/delink" \
 *   -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *   -H "Content-Type: application/json" \
 *   -d '{"inventoryIds":["inv_abc","inv_def"]}'
 *
 * Expected successful response (200):
 * {
 *   "id": "design_123",
 *   "title": "Summer Tee",
 *   "inventory_items": [
 *     // remaining linked inventory entries (inventory entries removed above will no longer appear)
 *   ],
 *   // other fields (respecting queryConfig.fields if provided)
 * }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";

import { AdminDeleteDesignInventoryReq } from "../validators";
import { delinkDesignInventoryWorkflow } from "../../../../../../workflows/designs/inventory/link-inventory";
import { refetchDesign, DesignInventoryAllowedFields } from "../helpers";

export const POST = async (
  req: MedusaRequest<AdminDeleteDesignInventoryReq>,
  res: MedusaResponse,
) => {
  const designId = req.params.id
  
  const { result, errors } = await delinkDesignInventoryWorkflow(req.scope).run({
    input: {
      design_id: designId,
      inventory_ids: req.validatedBody.inventoryIds
    },
  })

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const design = await refetchDesign(
    req.params.id,
    req.scope,
    (req.queryConfig?.fields as DesignInventoryAllowedFields[]) || ["*"],
  );

  res.status(200).json(design);
};
