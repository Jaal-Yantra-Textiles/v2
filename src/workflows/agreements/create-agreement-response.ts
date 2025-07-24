import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementsService from "../../modules/agreements/service";

export type CreateAgreementResponseStepInput = {
  agreement_id: string;
  person_id: string; // Reference to person from person module
  status?: "sent" | "viewed" | "agreed" | "disagreed" | "expired";
  sent_at: Date;
  viewed_at?: Date;
  responded_at?: Date;
  agreed?: boolean; // true = agreed, false = disagreed, null = no response
  response_notes?: string; // Optional notes from the person
  email_sent_to: string; // Email address where agreement was sent
  email_opened?: boolean;
  email_opened_at?: Date;
  response_ip?: string;
  response_user_agent?: string;
  metadata?: Record<string, any>;
};

export const createAgreementResponseStep = createStep(
  "create-agreement-response-step",
  async (input: CreateAgreementResponseStepInput, { container }) => {
    const service: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    const created = await service.createAgreementResponses(input);
    return new StepResponse(created, created.id);
  },
  async (id: string, { container }) => {
    const service: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    await service.softDeleteAgreementResponses(id);
  }
);

export type CreateAgreementResponseWorkflowInput = CreateAgreementResponseStepInput;

export const createAgreementResponseWorkflow = createWorkflow(
  "create-agreement-response",
  (input: CreateAgreementResponseWorkflowInput) => {
    const result = createAgreementResponseStep(input);
    return new WorkflowResponse(result);
  }
);
