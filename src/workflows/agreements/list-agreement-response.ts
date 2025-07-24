import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementResponseService from "../../modules/agreements/service";

export type ListAgreementResponseStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listAgreementResponseStep = createStep(
  "list-agreement-response-step",
  async (input: ListAgreementResponseStepInput, { container }) => {
    const service: AgreementResponseService = container.resolve(AGREEMENTS_MODULE);
    const results = await service.listAndCountAgreementResponses(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListAgreementResponseWorkflowInput = ListAgreementResponseStepInput;

export const listAgreementResponseWorkflow = createWorkflow(
  "list-agreement-response",
  (input: ListAgreementResponseWorkflowInput) => {
    const results = listAgreementResponseStep(input);
    return new WorkflowResponse(results);
  }
);
