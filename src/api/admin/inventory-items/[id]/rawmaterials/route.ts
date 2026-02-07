
/**
 * POST handler to create a raw material for an inventory item.
 *
 * Creates a raw material associated with the inventory item specified by req.params.id.
 * - Validates request body against the RawMaterial validator.
 * - Executes the createRawMaterialWorkflow within the request scope.
 * - If the workflow reports errors, those errors are thrown.
 * - On success, refetches the created raw material (optionally projecting fields) and
 *   returns it in the response with HTTP 201 Created.
 *
 * @remarks
 * - Endpoint path: /admin/inventory-items/:id/rawmaterials
 * - Request scope (req.scope) is passed to the workflow and refetch helper.
 * - The refetch operation uses req.remoteQueryConfig?.fields if provided, otherwise selects all fields ["*"].
 * - The handler expects req.validatedBody.rawMaterialData to contain the raw material payload.
 *
 * @param req - MedusaRequest with generic body RawMaterial and optional remoteQueryConfig:
 *                { remoteQueryConfig?: { fields?: RawMaterialAllowedFields[] } }
 *               - req.params.id: inventory item id to which the raw material will be attached
 *               - req.validatedBody.rawMaterialData: payload for the new raw material
 * @param res - MedusaResponse used to send the created raw material with status 201
 *
 * @returns Promise<void> - on success responds with JSON body of the created raw material and status 201
 *
 * @throws If the createRawMaterialWorkflow reports any errors, those errors are thrown (causes non-2xx response).
 *
 * @example Curl
 * curl -X POST "https://your-medusa-host.com/admin/inventory-items/inv_123/rawmaterials" \
 *   -H "Authorization: Bearer <admin-token>" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "rawMaterialData": {
 *       "sku": "RM-001",
 *       "name": "Stainless Steel Sheet",
 *       "quantity": 100,
 *       "unit": "pcs",
 *       "metadata": { "grade": "304" }
 *     }
 *   }'
 *
 * @example Fetch (Node/Browser)
 * const res = await fetch("/admin/inventory-items/inv_123/rawmaterials", {
 *   method: "POST",
 *   headers: {
 *     "Content-Type": "application/json",
 *     "Authorization": `Bearer ${adminToken}`,
 *   },
 *   body: JSON.stringify({
 *     rawMaterialData: {
 *       sku: "RM-002",
 *       name: "Aluminum Coil",
 *       quantity: 50,
 *       unit: "kg"
 *     }
 *   })
 * });
 * if (res.status === 201) {
 *   const created = await res.json();
 *   console.log("Created raw material:", created);
 * } else {
 *   // inspect error response
 * }
 *
 * @example TypeScript (server-side invocation)
 * // req.remoteQueryConfig can limit returned fields:
 * req.remoteQueryConfig = { fields: ["id", "sku", "name"] };
 * // call handler as shown in the file's routing layer; final response JSON will include only requested fields.
 *
 * @statuscodes
 * - 201: Created — raw material created and returned
 * - 4xx/5xx: Errors reported by workflow or validation; original errors thrown
 */
import {
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http";
import { RawMaterial } from "./validators";
import { createRawMaterialWorkflow } from "../../../../../workflows/raw-materials/create-raw-material";
import { RawMaterialAllowedFields, refetchRawMaterial } from "./helpers";

export const POST = async (
  req: MedusaRequest<RawMaterial> & {
    remoteQueryConfig?: {
      fields?: RawMaterialAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const { errors } = await createRawMaterialWorkflow(req.scope).run({
    input: {
      inventoryId: req.params.id,
      rawMaterialData: req.validatedBody.rawMaterialData
    },
  });

  if (errors.length > 0) {
    console.warn("Error reported at", errors);
    throw errors;
  }

  const rawMaterial = await refetchRawMaterial(
    req.params.id,
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );

  res.status(201).json( rawMaterial );
};
