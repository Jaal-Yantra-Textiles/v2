import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentService from "../../modules/internal_payments/service";

export type DeletePaymentStepInput = {
  id: string;
};

export const deletePaymentStep = createStep(
  "delete-payment-step",
  async (input: DeletePaymentStepInput, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const original = await service.retrievePayment(input.id);

    await service.deletePayments(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.createPayments(original);
  }
);

export type DeletePaymentWorkflowInput = DeletePaymentStepInput;

export const deletePaymentWorkflow = createWorkflow(
  "delete-payment",
  (input: DeletePaymentWorkflowInput) => {
    const result = deletePaymentStep(input);
    return new WorkflowResponse(result);
  }
);
