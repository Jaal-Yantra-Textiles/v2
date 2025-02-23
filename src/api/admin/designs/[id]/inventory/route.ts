import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";

import { AdminPostDesignInventoryReq } from "../inventory/validators";
import { linkDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/link-inventory";
import { DesignInventoryAllowedFields, refetchDesign } from "../inventory/helpers";
import { listDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/list-design-inventory";
  
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


  export const GET = async (
    req: MedusaRequest & {
      params: { id: string };
      remoteQueryConfig?: {
        fields?: DesignInventoryAllowedFields[];
      };
    },
    res: MedusaResponse,
  ) => {
    const designId = req.params.id
    
    const { result, errors } = await listDesignInventoryWorkflow(req.scope).run({
      input: {
        design_id: designId,
      },
    })  

    if (errors.length > 0) { 
      console.warn("Error reported at", errors);
      throw errors;
    }

    res.status(200).json({ design: result });
  };
  
  
  