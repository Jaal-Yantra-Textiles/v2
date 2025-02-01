import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PartnerPeopleSchema } from "./validators";
import { reFetchPartner } from "./helpers";
import { listPeopleOfPartner } from "../../../workflows/partner/list-partner-people";
import addPeoplePartnerWorkflow from "../../../workflows/partner/add-people-partner";

export const POST = async (
    req: AuthenticatedMedusaRequest<PartnerPeopleSchema>,
    res: MedusaResponse
) => {
    
    const partnerId = req.params.id
    const { people } = req.validatedBody

     await addPeoplePartnerWorkflow(req.scope).run({
        input: {
            partner_id: partnerId,
            people
        }
    })
    const partner = await reFetchPartner(partnerId, req.scope)
    res.json({
        partner: partner
    })
}

export const GET = async (
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) => {
    const  partnerId = req.params.id
    const {result:partner} = await listPeopleOfPartner(req.scope).run({
        input: {
            partnerId: partnerId
        }
    })

    const partnerA = await reFetchPartner(partnerId, req.scope)
 
  
    res.json({
        partner: partner[0]
    })
}