import {
    MedusaRequest,
    MedusaResponse,
  } from "@medusajs/framework/http";

import { AdminPatchDesignInventoryLinkReq, AdminPostDesignInventoryReq } from "../inventory/validators";
import { linkDesignInventoryWorkflow, updateDesignInventoryLinkWorkflow } from "../../../../../workflows/designs/inventory/link-inventory";
import { DesignInventoryAllowedFields, refetchDesign } from "../inventory/helpers";
import { listDesignInventoryWorkflow } from "../../../../../workflows/designs/inventory/list-design-inventory";
  
  export const POST = async (
    req: MedusaRequest<AdminPostDesignInventoryReq>,
    res: MedusaResponse,
  ) => {

    const designId = req.params.id
    
    const { result, errors } = await linkDesignInventoryWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_ids: req.validatedBody.inventoryIds,
        inventory_items: req.validatedBody.inventoryItems?.map((item) => ({
          inventory_id: item.inventoryId,
          planned_quantity: item.plannedQuantity,
          location_id: item.locationId,
          metadata: item.metadata,
        })),
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
  
    res.status(201).json( design );
  };


  export const GET = async (
    req: MedusaRequest,
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

    res.status(200).json(result);
  };

  export const PATCH = async (
    req: MedusaRequest<AdminPatchDesignInventoryLinkReq>,
    res: MedusaResponse,
  ) => {
    const designId = req.params.id;
    const { inventoryLinkId } = req.params as { inventoryLinkId: string };

    const { errors } = await updateDesignInventoryLinkWorkflow(req.scope).run({
      input: {
        design_id: designId,
        inventory_id: inventoryLinkId,
        planned_quantity: req.validatedBody.plannedQuantity,
        location_id: req.validatedBody.locationId,
        metadata: req.validatedBody.metadata ?? undefined,
      },
    });

    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }

    const design = await refetchDesign(
      designId,
      req.scope,
      (req.queryConfig?.fields as DesignInventoryAllowedFields[]) || ["*"],
    );

    res.status(200).json(design);
  };