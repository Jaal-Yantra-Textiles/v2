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
