import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "zod";
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders";
import InventoryOrderService from "../../../../../modules/inventory_orders/service";
import { refetchPartnerForThisAdmin } from "../../../helpers";
import { setInventoryOrderStepSuccessWorkflow } from "../../../../../workflows/inventory_orders/inventory-order-steps";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";
import { MedusaError } from "@medusajs/framework/utils";

const requestBodySchema = z.object({
    notes: z.string().optional(),
    deliveryDate: z.string().optional(),
    trackingNumber: z.string().optional()
});

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const orderId = req.params.orderId;
    
    // Validate request body
    const validation = requestBodySchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({
            error: "Invalid request body",
            details: validation.error.errors
        });
    }
    
    const { notes, deliveryDate, trackingNumber } = validation.data;

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
            throw new MedusaError(MedusaError.Types.NOT_FOUND, `Inventory order ${orderId} not found`)
        }
        
        // Check if order is in correct state
        if (order.status !== 'Processing') {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${orderId} is not in Processing state`)
        }
        
        // Check if partner has started the order
        if (order.metadata?.partner_status !== 'started') {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${orderId} is not in started state`)
        }
        
        // Get the workflow transaction ID from metadata
        const transactionId = order.metadata?.partner_workflow_transaction_id;
        if (!transactionId) {
            throw new MedusaError(MedusaError.Types.NOT_ALLOWED, `Inventory order ${orderId} is not assigned to a partner workflow`)
        }
        
        // Update order metadata with completion details
        const completionMetadata = {
            ...order.metadata,
            partner_completed_at: new Date().toISOString(),
            partner_status: 'completed',
            partner_completion_notes: notes,
            partner_delivery_date: deliveryDate,
            partner_tracking_number: trackingNumber
        };
        
        // Following the exact pattern from task routes: use updateWorkflow first
        const { result, errors } = await updateInventoryOrderWorkflow(req.scope).run({
            input: {
                id: orderId,
                update: {
                    status: "Shipped", // Update final status to Shipped when partner completes
                    metadata: completionMetadata
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
        
        console.log("updateInventoryOrderWorkflow result:", result);
        
        // Signal the workflow that the order has been completed
        // Use result[0] from updateWorkflow, matching task pattern exactly
        const { result: stepResult, errors: stepErrors } = await setInventoryOrderStepSuccessWorkflow(req.scope).run({
            input: {
                stepId: 'await-order-completion',
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
            message: "Order completed successfully",
            order: result[0], // Return the order from updateWorkflow result
            workflowResult: result
        });
        
}
