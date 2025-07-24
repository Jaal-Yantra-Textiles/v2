import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementService from "../../modules/agreements/service";

export type ListAgreementStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
};

export const listAgreementStep = createStep(
  "list-agreement-step",
  async (input: ListAgreementStepInput, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    const results = await service.listAndCountAgreements(
      input.filters,
      input.config
    );
    return new StepResponse(results);
  }
);

export type ListAgreementWorkflowInput = ListAgreementStepInput;

export const listAgreementWorkflow = createWorkflow(
  "list-agreement",
  (input: ListAgreementWorkflowInput) => {
    const results = listAgreementStep(input);
    return new WorkflowResponse(results);
  }
);
