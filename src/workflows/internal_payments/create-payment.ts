import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { INTERNAL_PAYMENTS_MODULE } from "../../modules/internal_payments";
import PaymentService from "../../modules/internal_payments/service";

export type CreatePaymentStepInput = {
  // TODO: Define the properties for creating a Payment from your model
  // Example: name: string;
  amount: number;
  status?: "Pending" | "Processing" | "Completed" | "Failed" | "Cancelled";
  payment_type: "Bank" | "Cash" | "Digital_Wallet";
  payment_date: Date;
  metadata?: Record<string, any> | null;
  paid_to_id?: string;
};


export const createPaymentStep = createStep(
  "create-payment-step",
  async (input: CreatePaymentStepInput, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    const created = await service.createPayments(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: PaymentService = container.resolve(INTERNAL_PAYMENTS_MODULE);
    await service.softDeletePayments(id);
  }
);

export type CreatePaymentWorkflowInput = CreatePaymentStepInput;

export const createPaymentWorkflow = createWorkflow(
  "create-payment",
  (input: CreatePaymentWorkflowInput) => {
    const result = createPaymentStep(input);
    return new WorkflowResponse(result);
  }
);
