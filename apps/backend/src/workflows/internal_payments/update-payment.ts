import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentService from "../../modules/internal_payments/service";

export type UpdatePaymentStepInput = {
  id: string;
  // TODO: Define optional properties for updating a Payment from your model
  // Example: name?: string
  amount?: number; // bigNumber handled as number in service
  status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  payment_type?: "Bank" | "Cash" | "Digital_Wallet";
  payment_date?: Date; // accept ISO string or Date
  metadata?: Record<string, any> | null;
  paid_to_id?: string; // relation to PaymentDetails
};

export const updatePaymentStep = createStep(
  "update-payment-step",
  async (input: UpdatePaymentStepInput, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrievePayment(id);

    const updated = await service.updatePayments({ id, ...updateData });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.updatePayments({ id: compensationData.id, ...compensationData.originalData });
  }
);

export type UpdatePaymentWorkflowInput = UpdatePaymentStepInput;

export const updatePaymentWorkflow = createWorkflow(
  "update-payment",
  (input: UpdatePaymentWorkflowInput) => {
    const result = updatePaymentStep(input);
    return new WorkflowResponse(result);
  }
);
