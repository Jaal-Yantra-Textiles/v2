import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getAllInventoryWithRawMaterial, RawMaterialAllowedFields } from "../[id]/rawmaterials/helpers";
import RawMaterialInventoryLink from "../../../../links/raw-material-data-inventory";

interface QueryParams {
  limit?: string;
  offset?: string;
  [key: string]: any;
}

export const GET = async (
  req: MedusaRequest & {
    remoteQueryConfig?: {
      fields?: RawMaterialAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  // Get filters from query parameters
  const filters = req.filterableFields || {};
  
  const inventoryWithRawMaterials = await getAllInventoryWithRawMaterial(
    req.scope,
    filters,
    req.remoteQueryConfig?.fields || ["*"],
  );
  
  res.status(200).json({
    inventory_items: inventoryWithRawMaterials,
    count: inventoryWithRawMaterials.length,
    offset: req.validatedQuery?.offset || 0,
    limit: req.validatedQuery?.limit || 10,
  });
};