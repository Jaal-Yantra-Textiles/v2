import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentDetailsService from "../../modules/internal_payments/service";

export type DeletePaymentDetailsStepInput = {
  id: string;
};

export const deletePaymentDetailsStep = createStep(
  "delete-payment-details-step",
  async (input: DeletePaymentDetailsStepInput, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const original = await service.retrievePaymentDetails(input.id);

    await service.deletePaymentDetails(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.createPaymentDetails(original);
  }
);

export type DeletePaymentDetailsWorkflowInput = DeletePaymentDetailsStepInput;

export const deletePaymentDetailsWorkflow = createWorkflow(
  "delete-payment-details",
  (input: DeletePaymentDetailsWorkflowInput) => {
    const result = deletePaymentDetailsStep(input);
    return new WorkflowResponse(result);
  }
);
