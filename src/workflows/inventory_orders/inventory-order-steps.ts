import {
    ContainerRegistrationKeys,
    Modules,
    TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { sendInventoryOrderToPartnerWorkflow } from "./send-to-partner";

const TASKS_MODULE = "tasksModuleService"

type SetInventoryOrderStepSuccessInput = {
    stepId: string;
    updatedOrder: any;
};

export const setInventoryOrderStepSuccessStep = createStep(
    "set-inventory-order-step-success",
    async function (
        { stepId, updatedOrder }: SetInventoryOrderStepSuccessInput,
        { container, context }
    ) {
        console.log("setInventoryOrderStepSuccessStep", updatedOrder)
        const engineService = container.resolve(
            Modules.WORKFLOW_ENGINE
        )
        
        // Get the workflow transaction ID from associated tasks instead of order metadata
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        
        // Find tasks linked to this inventory order that have a transaction ID
        const taskLinksResult = await query.graph({
            entity: "inventory_orders",
            fields: [
                "id",
                "inventory_order_id",
                "tasks.*"
            ],
            filters: {
                id: updatedOrder.id
            }
        })
        const taskLinks = taskLinksResult.data || []
        try {
            const first = Array.isArray(taskLinks) ? taskLinks[0] : undefined
            const tasksPreview = first?.tasks ? first.tasks.map((t: any) => ({ id: t.id, status: t.status })) : []
            console.log("taskLinksResult preview", { count: taskLinks.length, tasksPreview })
        } catch (e) {
            console.warn("Unable to log taskLinksResult safely")
        }
        
        // Find a task with a transaction ID (should be one of the partner workflow tasks)
        let workflowTransactionId: string | null = null
        for (const order of taskLinks) {
            if (order.tasks && Array.isArray(order.tasks)) {
                for (const task of order.tasks) {
                    if (task && task.transaction_id) {
                        workflowTransactionId = task.transaction_id
                        break
                    }
                }
                if (workflowTransactionId) break
            }
        }
        
        if (!workflowTransactionId) {
            throw new Error(`No workflow transaction ID found in tasks for inventory order ${updatedOrder.id}`);
        }
        
        console.log("Setting inventory order step success:", {
            stepId,
            workflowTransactionId,
            workflowName: sendInventoryOrderToPartnerWorkflow.getName()
        });
        
        await engineService.setStepSuccess({
            idempotencyKey: {
                action: TransactionHandlerType.INVOKE,
                transactionId: workflowTransactionId,
                stepId,
                workflowId: sendInventoryOrderToPartnerWorkflow.getName(),
            },
            stepResponse: new StepResponse(updatedOrder, updatedOrder.id),
        })

        // Emit an admin feed success notification indicating step was signaled
        try {
            const eventService = container.resolve(Modules.EVENT_BUS)
            const title = stepId === "await-order-start" ? "Inventory Order Started" : (stepId === "await-order-completion" ? "Inventory Order Completed" : "Inventory Order Step Succeeded")
            const description = stepId === "await-order-start"
                ? `Order ${updatedOrder.id} was marked as started by partner.`
                : (stepId === "await-order-completion" ? `Order ${updatedOrder.id} was marked as completed by partner.` : `Order ${updatedOrder.id} step ${stepId} succeeded.`)
            await eventService.emit({
                name: "admin_feed_notification",
                data: {
                    channel: "feed",
                    template: "admin-ui",
                    title,
                    description,
                    metadata: {
                        inventory_order_id: updatedOrder.id,
                        step_id: stepId,
                        transaction_id: workflowTransactionId,
                        action: "workflow_step_success",
                    }
                }
            })
        } catch (e) {
            console.warn("Failed to emit step success admin feed notification", e)
        }
    }
)

type SetInventoryOrderStepFailedInput = {
    stepId: string;
    updatedOrder: any;
    error?: string;
};

export const setInventoryOrderStepFailedStep = createStep(
    "set-inventory-order-step-failed",
    async function (
        { stepId, updatedOrder, error }: SetInventoryOrderStepFailedInput,
        { container }
    ) {
        const engineService = container.resolve(
            Modules.WORKFLOW_ENGINE
        )
        const taskService = container.resolve(TASKS_MODULE)
        
        // Get the workflow transaction ID from associated tasks instead of order metadata
        const query = container.resolve(ContainerRegistrationKeys.QUERY)
        
        // Find tasks linked to this inventory order that have a transaction ID
        const taskLinksResult = await query.graph({
            entity: "inventory_orders",
            fields: [
                "id",
                "tasks.*"
            ],
            filters: {
                id: updatedOrder.id
            }
        })
        
        const taskLinks = taskLinksResult.data || []
        
        // Find a task with a transaction ID (should be one of the partner workflow tasks)
        let workflowTransactionId: string | null = null
        for (const order of taskLinks) {
            if (order.tasks && Array.isArray(order.tasks)) {
                for (const task of order.tasks) {
                    if (task && task.transaction_id) {
                        workflowTransactionId = task.transaction_id
                        break
                    }
                }
                if (workflowTransactionId) break
            }
        }
        
        if (!workflowTransactionId) {
            throw new Error(`No workflow transaction ID found in tasks for inventory order ${updatedOrder.id}`);
        }
        
        console.log("Setting inventory order step failure:", {
            stepId,
            workflowTransactionId,
            error,
            workflowName: sendInventoryOrderToPartnerWorkflow.getName()
        });
        
        await engineService.setStepFailure({
            idempotencyKey: {
                action: TransactionHandlerType.INVOKE,
                transactionId: workflowTransactionId,
                stepId,
                workflowId: sendInventoryOrderToPartnerWorkflow.getName(),
            },
            stepResponse: new StepResponse(updatedOrder, updatedOrder.id),
        })

        // Emit an admin feed failure notification so failures are visible in UI
        try {
            const eventService = container.resolve(Modules.EVENT_BUS)
            await eventService.emit({
                name: "admin_feed_notification",
                data: {
                    channel: "feed",
                    template: "admin-ui",
                    title: "Inventory Order Workflow Step Failed",
                    description: `Order ${updatedOrder.id} step ${stepId} failed${error ? `: ${error}` : ''}`,
                    metadata: {
                        inventory_order_id: updatedOrder.id,
                        step_id: stepId,
                        transaction_id: workflowTransactionId,
                        action: "workflow_step_failure",
                        error,
                    }
                }
            })
        } catch (e) {
            console.warn("Failed to emit step failure admin feed notification", e)
        }
    }
)

export const setInventoryOrderStepSuccessWorkflow = createWorkflow(
    {
        name: "set-inventory-order-step-success-workflow",
        store: true
    },
    (input: SetInventoryOrderStepSuccessInput) => {
        const result = setInventoryOrderStepSuccessStep(input);
        return new WorkflowResponse(result);
    },
)

export const setInventoryOrderStepFailedWorkflow = createWorkflow(
    {
        name: "set-inventory-order-step-failed-workflow", 
        store: true
    },
    (input: SetInventoryOrderStepFailedInput) => {
        const result = setInventoryOrderStepFailedStep(input);
        return new WorkflowResponse(result);
    },
)
