import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentDetailsService from "../../modules/internal_payments/service";

export type CreatePaymentDetailsStepInput = {
  // TODO: Define the properties for creating a PaymentDetails from your model
  // Example: name: string;
  amount: number;
  status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  payment_type: "Bank" | "Cash" | "Digital_Wallet";
  payment_date: Date;
  metadata?: Record<string, any> | null;
  paid_to_id?: string;
};

export const createPaymentDetailsStep = createStep(
  "create-payment-details-step",
  async (input: CreatePaymentDetailsStepInput, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const created = await service.createPaymentDetails(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: PaymentDetailsService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.softDeletePaymentDetails(id);
  }
);

export type CreatePaymentDetailsWorkflowInput = CreatePaymentDetailsStepInput;

export const createPaymentDetailsWorkflow = createWorkflow(
  "create-payment-details",
  (input: CreatePaymentDetailsWorkflowInput) => {
    const result = createPaymentDetailsStep(input);
    return new WorkflowResponse(result);
  }
);
