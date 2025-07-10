import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { suspendUserWorkflow } from "../../../../../workflows/users/suspend-user";

export const POST = async (
    req: MedusaRequest,
    res: MedusaResponse
) => {
    const { id } = req.params
    const { result, errors } = await suspendUserWorkflow(req.scope).run({
        input: {
            userId: id
        }
    })

    if (errors.length > 0) {   
        return res.status(400).json(errors)
    }
   res.status(200).json({
    suspended: true
   })
}