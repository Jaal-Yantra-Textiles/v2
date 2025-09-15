import {
    ContainerRegistrationKeys,
    Modules,
    TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { notifyOnFailureStep, sendNotificationsStep } from "@medusajs/medusa/core-flows"
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
    }
)

export const setInventoryOrderStepSuccessWorkflow = createWorkflow(
    {
        name: "set-inventory-order-step-success-workflow",
        store: true
    },
    (input: SetInventoryOrderStepSuccessInput) => {
        // Failure notification if this workflow itself errors
        const failureNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed",
                    template: "admin-ui",
                    data: {
                        title: "Inventory Order Workflow Signal",
                        description: `Failed to mark step ${data.input.stepId} as success for order ${data.input.updatedOrder?.id}.`,
                    },
                },
            ]
        })
        notifyOnFailureStep(failureNotification)

        const result = setInventoryOrderStepSuccessStep(input)

        // Success notification
        const successNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed",
                    template: "admin-ui",
                    data: {
                        title: "Inventory Order Workflow Signal",
                        description: `Marked step ${data.input.stepId} as success for order ${data.input.updatedOrder?.id}.`,
                    },
                },
            ]
        })
        sendNotificationsStep(successNotification)
        return new WorkflowResponse(result)
    },
)

export const setInventoryOrderStepFailedWorkflow = createWorkflow(
    {
        name: "set-inventory-order-step-failed-workflow", 
        store: true
    },
    (input: SetInventoryOrderStepFailedInput) => {
        // Failure notification if this workflow itself errors
        const failureNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed",
                    template: "admin-ui",
                    data: {
                        title: "Inventory Order Workflow Signal",
                        description: `Failed to mark step ${data.input.stepId} as failed for order ${data.input.updatedOrder?.id}.`,
                    },
                },
            ]
        })
        notifyOnFailureStep(failureNotification)

        const result = setInventoryOrderStepFailedStep(input)

        // Success notification
        const successNotification = transform({ input }, (data) => {
            return [
                {
                    to: "",
                    channel: "feed",
                    template: "admin-ui",
                    data: {
                        title: "Inventory Order Workflow Signal",
                        description: `Marked step ${data.input.stepId} as failed for order ${data.input.updatedOrder?.id}.`,
                    },
                },
            ]
        })
        sendNotificationsStep(successNotification)
        return new WorkflowResponse(result)
    },
)
