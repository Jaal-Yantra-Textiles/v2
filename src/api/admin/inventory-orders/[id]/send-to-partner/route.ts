import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { sendInventoryOrderToPartnerWorkflow } from "../../../../../workflows/inventory_orders/send-to-partner";
import { setInventoryOrderStepSuccessWorkflow } from "../../../../../workflows/inventory_orders/inventory-order-steps";
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

        // Create transaction object with the real transaction ID (matching task pattern)
        const postOrderTransactionId = {
            transaction_id: transaction.transactionId,
            metadata: {
                partner_workflow_transaction_id: transaction.transactionId
            }
        }

        console.log("Manually signaling notify-partner step with transaction:", transaction.transactionId);

        // Manually signal the notify-partner step (matching task assignment pattern)
        await setInventoryOrderStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'notify-partner-inventory-order',
                updatedOrder: postOrderTransactionId
            }
        }).catch((error) => {
            console.error("Error signaling notify step:", error);
            throw error;
        });

        res.status(200).json({
            message: "Inventory order sent to partner successfully",
            inventoryOrderId,
            partnerId,
            transactionId: transaction.transactionId
        });
}
