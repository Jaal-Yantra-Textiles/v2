import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { linkDesignPartnerWorkflow } from "../../../../../workflows/designs/partner/link-design-to-partner";
import { LinkDesignPartner } from "../../validators";


 export const POST = async (
    req: MedusaRequest<LinkDesignPartner>,
    res: MedusaResponse,
  ) => {

    const designId = req.params.id
    
    const { result, errors } = await linkDesignPartnerWorkflow(req.scope).run({
      input: {
        design_id: designId,
        partner_ids: req.validatedBody.partnerIds
      },
    })
  
    if (errors.length > 0) {
      console.warn("Error reported at", errors);
      throw errors;
    }
  
    res.status(201).json( result );
  };