import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { setInventoryOrderStepSuccessWorkflow } from "../../../../../workflows/inventory_orders/inventory-order-steps";
import { updateInventoryOrderWorkflow } from "../../../../../workflows/inventory_orders/update-inventory-order";
import { ORDER_INVENTORY_MODULE } from "../../../../../modules/inventory_orders";
import InventoryOrderService from "../../../../../modules/inventory_orders/service";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { getPartnerFromActorId, refetchPartnerForThisAdmin } from "../../../helpers";
import { TASKS_MODULE } from "../../../../../modules/tasks";
import TaskService from "../../../../../modules/tasks/service";

export async function POST(
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) {
    const orderId = req.params.orderId;
    
    // Get the authenticated partner using the same pattern as details route
    const adminId = req.auth_context?.actor_id;
    const partnerAdmin = await getPartnerFromActorId(adminId, req.scope);
    
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
    for (const order of taskLinks) {
        if (order.tasks && Array.isArray(order.tasks)) {
            for (const task of order.tasks) {
                if (task && task.transaction_id) {
                    transactionId = task.transaction_id
                    break
                }
            }
            if (transactionId) break
        }
    }
    
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
    
    // Mark the "received" task as completed to update partner status
    const taskService: TaskService = req.scope.resolve(TASKS_MODULE);
    
    // Find and update the "partner-order-received" task from the tasks we already retrieved
    const receivedTaskName = "partner-order-received";
    let tasksToUpdate: any[] = [];
    
    console.log("Looking for tasks to update with name:", receivedTaskName);
    console.log("TaskLinks data:", JSON.stringify(taskLinks, null, 2));
    
    // Extract tasks from the taskLinks result
    for (const orderData of taskLinks) {
        if (orderData.tasks && Array.isArray(orderData.tasks)) {
            console.log("Found tasks in order:", orderData.tasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status })));
            const receivedTasks = orderData.tasks.filter((task: any) => 
                task.title === receivedTaskName && task.status !== 'completed'  // ✅ Use task.title instead of task.name
            );
            console.log("Filtered received tasks:", receivedTasks.map((t: any) => ({ id: t.id, title: t.title, status: t.status })));
            tasksToUpdate.push(...receivedTasks);
        }
    }
    
    console.log("Total tasks to update:", tasksToUpdate.length);
    
    if (tasksToUpdate.length > 0) {
        for (const task of tasksToUpdate) {
            console.log(`Updating task ${task.id} (${task.name}) from ${task.status} to completed`);
            await taskService.updateTasks({
                id: task.id,
                status: 'completed',
                metadata: {
                    ...task.metadata,
                    completed_at: new Date().toISOString(),
                    completed_by: 'partner'
                }
            });
            console.log(`Task ${task.id} updated successfully`);
        }
    } else {
        console.log("No tasks found to update - this might be the issue!");
    }
    
    // Signal the workflow that the order has been started
    // Use result[0] from updateWorkflow, matching task pattern exactly
    const { result: stepResult, errors: stepErrors } = await setInventoryOrderStepSuccessWorkflow(req.scope).run({
        input: {
            stepId: 'await-order-start',
            updatedOrder: result // Pass the updated order object directly
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
        order: result, // Return the order object from updateWorkflow result
        workflowResult: stepResult
    });
}
