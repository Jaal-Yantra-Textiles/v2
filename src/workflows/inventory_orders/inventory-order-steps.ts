import {
    Modules,
    TransactionHandlerType,
} from "@medusajs/framework/utils"
import { StepResponse, WorkflowResponse, createStep, createWorkflow } from "@medusajs/framework/workflows-sdk"
import { sendInventoryOrderToPartnerWorkflow } from "./send-to-partner";

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
        
        // Get the workflow transaction ID from the order metadata
        const workflowTransactionId = updatedOrder.metadata?.partner_workflow_transaction_id;
        
        if (!workflowTransactionId) {
            throw new Error("No workflow transaction ID found in order metadata");
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
            options: {
                container,
            },
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
        
        // Get the workflow transaction ID from the order metadata
        const workflowTransactionId = updatedOrder.metadata?.partner_workflow_transaction_id;
        
        if (!workflowTransactionId) {
            throw new Error("No workflow transaction ID found in order metadata");
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
            options: {
                container,
            },
        })
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
