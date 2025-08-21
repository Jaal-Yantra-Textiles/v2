import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { sendInventoryOrderToPartnerWorkflow } from "../../../../../workflows/inventory_orders/send-to-partner";
import { SendInventoryOrderToPartnerInput } from "./validators";



export async function POST(
    req: AuthenticatedMedusaRequest<SendInventoryOrderToPartnerInput>,
    res: MedusaResponse
) {
    const inventoryOrderId = req.params.id;
    

    const { partnerId, notes } = req.validatedBody;
        // Start the workflow and get the transaction (don't wait for completion)
        const { transaction } = await sendInventoryOrderToPartnerWorkflow(req.scope).run({
            input: {
                inventoryOrderId,
                partnerId,
                notes
            }
        });

        res.status(200).json({
            message: "Inventory order sent to partner successfully",
            inventoryOrderId,
            partnerId,
            transactionId: transaction.transactionId
        });
}
