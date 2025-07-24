import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { unsuspendUserWorkflow } from "../../../../../workflows/users/unsuspend-user";

export const POST = async (
    req: MedusaRequest,
    res: MedusaResponse
) => {
    const { id } = req.params;
    const { result, errors } = await unsuspendUserWorkflow(req.scope).run({
        input: {
            userId: id
        }
    });

    if (errors && errors.length > 0) {
        return res.status(400).json({ errors });
    }

    res.status(200).json({
        suspended: false
    });
};
