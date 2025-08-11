import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentService from "../../modules/internal_payments/service";

export type ListPaymentStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listPaymentStep = createStep(
  "list-payment-step",
  async (input: ListPaymentStepInput, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const results = await service.listAndCountPayments(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListPaymentWorkflowInput = ListPaymentStepInput;

export const listPaymentWorkflow = createWorkflow(
  "list-payment",
  (input: ListPaymentWorkflowInput) => {
    const results = listPaymentStep(input);
    return new WorkflowResponse(results);
  }
);
