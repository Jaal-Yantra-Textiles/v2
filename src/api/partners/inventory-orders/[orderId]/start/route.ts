import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { setInventoryOrderStepSuccessWorkflow } from "../../../../../workflows/inventory_orders/inventory-order-steps";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders";
import InventoryOrderService from "../../../../../modules/inventory_orders/service";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { refetchPartnerForThisAdmin } from "../../../helpers";

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const orderId = req.params.orderId;
    
    // Get the authenticated partner using the same pattern as details route
    const adminId = req.auth_context.actor_id;
    const partnerAdmin = await refetchPartnerForThisAdmin(adminId, req.scope);
    
    if (!partnerAdmin) {
        return res.status(401).json({
            error: "Partner authentication required"
        });
    }
    const inventoryOrderService: InventoryOrderService = req.scope.resolve(ORDER_INVENTORY_MODULE);
    
    // Get the order to validate it exists and get transaction ID
    const order = await inventoryOrderService.retrieveInventoryOrder(orderId);
    
    if (!order) {
        return res.status(404).json({
            error: "Inventory order not found"
        });
    }
    // Check if order is in correct state (should be Pending when first assigned)
    if (order.status !== 'Pending') {
        return res.status(400).json({
            error: "Order is not in a state that can be started",
            currentStatus: order.status,
            expectedStatus: "Pending"
        });
    }
    
    // Get the workflow transaction ID from metadata
    const transactionId = order.metadata?.partner_workflow_transaction_id;
    if (!transactionId) {
        return res.status(400).json({
            error: "Order is not assigned to a partner workflow"
        });
    }
    
    // Update order status to Processing and indicate partner has started
    // Following the exact pattern from task routes: use updateWorkflow first
    const { result, errors } = await updateInventoryOrderWorkflow(req.scope).run({
        input: {
            id: orderId,
            update: {
                status: "Processing", // Change status from Pending to Processing
                metadata: {
                    ...order.metadata,
                    partner_started_at: new Date().toISOString(),
                    partner_status: 'started'
                }
            }
        }
    });
    
    if (errors && errors.length > 0) {
        console.warn("Error updating inventory order:", errors);
        return res.status(500).json({
            error: "Failed to update inventory order",
            details: errors
        });
    }
    
    
    // Signal the workflow that the order has been started
    // Use result[0] from updateWorkflow, matching task pattern exactly
    const { result: stepResult, errors: stepErrors } = await setInventoryOrderStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'await-order-start',
            updatedOrder: result[0] // Use result from updateWorkflow, just like tasks
        }
    });
    
    if (stepErrors && stepErrors.length > 0) {
        console.warn("Error signaling workflow:", stepErrors);
        return res.status(500).json({
            error: "Failed to update workflow",
            details: stepErrors
        });
    }
    
    res.status(200).json({
        message: "Order started successfully",
        order: result[0], // Return the order from updateWorkflow result
        workflowResult: stepResult
    });
}
