import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { z } from "zod";
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders";
import InventoryOrderService from "../../../../../modules/inventory_orders/service";
import { refetchPartnerForThisAdmin } from "../../../helpers";
import { setInventoryOrderStepSuccessWorkflow } from "../../../../../workflows/inventory_orders/inventory-order-steps";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";
import { MedusaError, ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

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
        
        // Get the workflow transaction ID from associated tasks instead of metadata
        const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
        
        // Find tasks linked to this inventory order that have a transaction ID
        const taskLinksResult = await query.graph({
            entity: "inventory_orders",
            fields: [
                "id",
                "tasks.*"
            ],
            filters: {
                id: orderId
            }
        })
        
        const taskLinks = taskLinksResult.data || []
        
        // Find a task with a transaction ID (should be one of the partner workflow tasks)
        let transactionId: string | null = null
        for (const orderData of taskLinks) {
            if (orderData.tasks && Array.isArray(orderData.tasks)) {
                for (const task of orderData.tasks) {
                    if (task && task.transaction_id) {
                        transactionId = task.transaction_id
                        break
                    }
                }
                if (transactionId) break
            }
        }
        
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
        
        // Mark the "shipped" task as completed to update partner status
        const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
        const queryService = req.scope.resolve(ContainerRegistrationKeys.QUERY);
        
        // Get tasks linked to this inventory order
        const shippedTaskLinksResult = await queryService.graph({
            entity: "inventory_orders",
            fields: [
                "id",
                "tasks.*"
            ],
            filters: {
                id: orderId
            }
        });
        
        const shippedTaskLinks = shippedTaskLinksResult.data || [];
        
        // Find and update the "partner-order-shipped" task
        const shippedTaskName = "partner-order-shipped";
        let tasksToUpdate: any[] = [];
        
        console.log("Looking for shipped tasks to update with title:", shippedTaskName);
        
        // Extract tasks from the taskLinks result
        for (const orderData of shippedTaskLinks) {
            if (orderData.tasks && Array.isArray(orderData.tasks)) {
                console.log("Found tasks in order:", orderData.tasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status })));
                const shippedTasks = orderData.tasks.filter((task: any) => 
                    task.title === shippedTaskName && task.status !== 'completed'
                );
                console.log("Filtered shipped tasks:", shippedTasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status })));
                tasksToUpdate.push(...shippedTasks);
            }
        }
        
        console.log("Total shipped tasks to update:", tasksToUpdate.length);
        
        if (tasksToUpdate.length > 0) {
            for (const task of tasksToUpdate) {
                console.log(`Updating shipped task ${task.id} (${task.title}) from ${task.status} to completed`);
                await taskService.updateTasks({
                    id: task.id,
                    status: 'completed',
                    metadata: {
                        ...task.metadata,
                        completed_at: new Date().toISOString(),
                        completed_by: 'partner'
                    }
                });
                console.log(`Shipped task ${task.id} updated successfully`);
            }
        } else {
            console.log("No shipped tasks found to update!");
        }
        
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
