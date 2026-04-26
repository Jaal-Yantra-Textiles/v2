import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentDetailsService from "../../modules/internal_payments/service";

export type ListPaymentDetailsStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listPaymentDetailsStep = createStep(
  "list-payment-details-step",
  async (input: ListPaymentDetailsStepInput, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const results = await service.listAndCountPaymentDetails(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListPaymentDetailsWorkflowInput = ListPaymentDetailsStepInput;

export const listPaymentDetailsWorkflow = createWorkflow(
  "list-payment-details",
  (input: ListPaymentDetailsWorkflowInput) => {
    const results = listPaymentDetailsStep(input);
    return new WorkflowResponse(results);
  }
);
