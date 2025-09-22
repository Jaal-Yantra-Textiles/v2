import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentDetailsService from "../../modules/internal_payments/service";

export type UpdatePaymentDetailsStepInput = {
  id: string;
  // TODO: Define optional properties for updating a PaymentDetails from your model
  // Example: name?: string;
  type?: "bank_account" | "cash_account" | "digital_wallet";
  account_name?: string;
  account_number?: string | null;
  bank_name?: string | null;
  ifsc_code?: string | null;
  wallet_id?: string | null;
  metadata?: Record<string, any> | null;
};

export const updatePaymentDetailsStep = createStep(
  "update-payment-details-step",
  async (input: UpdatePaymentDetailsStepInput, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrievePaymentDetails(id);

    const updated = await service.updatePaymentDetailses({ id, ...updateData });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.updatePaymentDetailses({ id: compensationData.id, ...compensationData.originalData });
  }
);

export type UpdatePaymentDetailsWorkflowInput = UpdatePaymentDetailsStepInput;

export const updatePaymentDetailsWorkflow = createWorkflow(
  "update-payment-details",
  (input: UpdatePaymentDetailsWorkflowInput) => {
    const result = updatePaymentDetailsStep(input);
    return new WorkflowResponse(result);
  }
);
