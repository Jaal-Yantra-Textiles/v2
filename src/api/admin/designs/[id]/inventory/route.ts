import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";

import { AdminPostDesignInventoryReq } from "../inventory/validators";
import { linkDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/link-inventory";
import { DesignInventoryAllowedFields, refetchDesign } from "../inventory/helpers";
  
  export const POST = async (
    req: MedusaRequest<AdminPostDesignInventoryReq> & {
      remoteQueryConfig?: {
        fields?: DesignInventoryAllowedFields[];
      };
    },
    res: MedusaResponse,
  ) => {

    const designId = req.params.id
    
    const { result, errors } = await linkDesignInventoryWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_ids: req.validatedBody.inventoryIds
      },
    })

    console.log(result)
  
    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }
  
    const design = await refetchDesign(
      req.params.id,
      req.scope,
      req.remoteQueryConfig?.fields || ["*"],
    );
  
    res.status(201).json( design );
  };
  
  
  