

/**
 * GET /api/admin/inventory-items/{id}/rawmaterials/{rawMaterialId}
 *
 * Retrieve a single raw material by ID for an inventory item.
 *
 * @remarks
 * - Resolves the RawMaterialService from the request scope.
 * - Includes the "material_type" relation in the returned entity.
 * - Returns HTTP 200 with a JSON payload: { raw_material: RawMaterial }.
 * - Returns HTTP 404 if the raw material is not found.
 *
 * @param req - MedusaRequest with route params: { id: string, rawMaterialId: string }.
 * @param res - MedusaResponse used to send JSON responses.
 *
 * @returns Promise<void> - writes response to res.
 *
 * @example curl
 * curl -X GET "https://your-domain.com/api/admin/inventory-items/INV_ITEM_ID/rawmaterials/RAW_MATERIAL_ID" \
 *      -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *      -H "Content-Type: application/json"
 *
 * @example fetch (node / browser)
 * const res = await fetch(`/api/admin/inventory-items/${invItemId}/rawmaterials/${rawMaterialId}`, {
 *   method: "GET",
 *   headers: { "Authorization": `Bearer ${token}` }
 * });
 * const data = await res.json();
 * // data.raw_material -> the raw material record (includes material_type)
 */

/**
 * PUT /api/admin/inventory-items/{id}/rawmaterials/{rawMaterialId}
 *
 * Update an existing raw material by ID.
 *
 * @remarks
 * - Runs an update workflow (updateRawMaterialWorkflow) with the provided validated body.
 * - Expects request validation to populate req.validatedBody with shape { rawMaterialData?: Partial<RawMaterial> } (see UpdateRawMaterial validator).
 * - If the workflow reports errors, the handler will throw them (they should be handled by higher-level error middleware).
 * - On success, the updated raw material is retrieved (including "material_type") and returned with HTTP 200:
 *   { raw_material: RawMaterial }.
 *
 * @param req - MedusaRequest<UpdateRawMaterial> with route params: { id: string, rawMaterialId: string } and validatedBody.rawMaterialData.
 * @param res - MedusaResponse used to send JSON responses.
 *
 * @returns Promise<void> - writes response to res.
 *
 * @throws WorkflowError[] - thrown when update workflow returns errors (should be handled by error middleware).
 *
 * @example request body
 * {
 *   "rawMaterialData": {
 *     "name": "Refined Cotton",
 *     "sku": "RC-001",
 *     "material_type_id": "MTYPE_ID",
 *     "metadata": { "color": "white" }
 *   }
 * }
 *
 * @example curl
 * curl -X PUT "https://your-domain.com/api/admin/inventory-items/INV_ITEM_ID/rawmaterials/RAW_MATERIAL_ID" \
 *      -H "Authorization: Bearer <ADMIN_TOKEN>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"rawMaterialData":{"name":"Refined Cotton","sku":"RC-001"}}'
 *
 * @example fetch (node / browser)
 * const res = await fetch(`/api/admin/inventory-items/${invItemId}/rawmaterials/${rawMaterialId}`, {
 *   method: "PUT",
 *   headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
 *   body: JSON.stringify({ rawMaterialData: { name: "Refined Cotton", sku: "RC-001" } })
 * });
 * const data = await res.json();
 * // data.raw_material -> updated raw material record
 */

/**
 * DELETE /api/admin/inventory-items/{id}/rawmaterials/{rawMaterialId}
 *
 * Delete one or more raw materials by ID(s).
 *
 * @remarks
 * - Uses RawMaterialService.deleteRawMaterials with an array of IDs (here a single ID).
 * - On success returns HTTP 200:
 *   { id: string, object: "raw_material", deleted: true }.
 * - On failure returns HTTP 500 with error message.
 *
 * @param req - MedusaRequest with route params: { id: string, rawMaterialId: string }.
 * @param res - MedusaResponse used to send JSON responses.
 *
 * @returns Promise<void> - writes response to res.
 *
 * @example curl
 * curl -X DELETE "https://your-domain.com/api/admin/inventory-items/INV_ITEM_ID/rawmaterials/RAW_MATERIAL_ID" \
 *      -H "Authorization: Bearer <ADMIN_TOKEN>"
 *
 * @example fetch (node / browser)
 * const res = await fetch(`/api/admin/inventory-items/${invItemId}/rawmaterials/${rawMaterialId}`, {
 *   method: "DELETE",
 *   headers: { "Authorization": `Bearer ${token}` }
 * });
 * const data = await res.json();
 * // { id: RAW_MATERIAL_ID, object: "raw_material", deleted: true }
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { RAW_MATERIAL_MODULE } from "../../../../../../modules/raw_material";
import RawMaterialService from "../../../../../../modules/raw_material/service";
import updateRawMaterialWorkflow from "../../../../../../workflows/raw-materials/update-raw-material";
import { UpdateRawMaterial } from "../validators";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const rawMaterialService: RawMaterialService = req.scope.resolve(RAW_MATERIAL_MODULE);
  const { rawMaterialId } = req.params;

  try {
    const rawMaterial = await rawMaterialService.retrieveRawMaterial(rawMaterialId, {
      relations: ["material_type"],
    });
    res.status(200).json({ raw_material: rawMaterial });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const PUT = async (
  req: MedusaRequest<UpdateRawMaterial>,
  res: MedusaResponse,
) => {
  const { rawMaterialId } = req.params;

  const {  errors } = await updateRawMaterialWorkflow(req.scope).run({
    input: {
      id: rawMaterialId,
      update: req.validatedBody.rawMaterialData || {}
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  // Fetch the updated raw material
  const rawMaterialService: RawMaterialService = req.scope.resolve(RAW_MATERIAL_MODULE);
  const rawMaterial = await rawMaterialService.retrieveRawMaterial(rawMaterialId, {
    relations: ["material_type"],
  });

  res.status(200).json({ raw_material: rawMaterial });
};

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const rawMaterialService: RawMaterialService = req.scope.resolve(RAW_MATERIAL_MODULE);
  const { rawMaterialId } = req.params;

  try {
    await rawMaterialService.deleteRawMaterials([rawMaterialId]);
    res.status(200).json({
      id: rawMaterialId,
      object: "raw_material",
      deleted: true,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
