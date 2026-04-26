import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementService from "../../modules/agreements/service";

export type CreateAgreementStepInput = {
  title: string;
  content: string; // HTML content of the agreement
  template_key?: string; // Optional: reference to email template
  status?: "draft" | "active" | "expired" | "cancelled";
  valid_from?: Date;
  valid_until?: Date;
  subject?: string;
  from_email?: string;
  metadata?: Record<string, any>;
};

export const createAgreementStep = createStep(
  "create-agreement-step",
  async (input: CreateAgreementStepInput, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    const created = await service.createAgreements(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    await service.softDeleteAgreements(id);
  }
);

export type CreateAgreementWorkflowInput = CreateAgreementStepInput;

export const createAgreementWorkflow = createWorkflow(
  "create-agreement",
  (input: CreateAgreementWorkflowInput) => {
    const result = createAgreementStep(input);
    return new WorkflowResponse(result);
  }
);
