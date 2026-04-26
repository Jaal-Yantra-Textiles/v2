import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementService from "../../modules/agreements/service";

export type DeleteAgreementStepInput = {
  id: string;
};

export const deleteAgreementStep = createStep(
  "delete-agreement-step",
  async (input: DeleteAgreementStepInput, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    const original = await service.retrieveAgreement(input.id);

    await service.deleteAgreements(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    await service.createAgreements(original);
  }
);

export type DeleteAgreementWorkflowInput = DeleteAgreementStepInput;

export const deleteAgreementWorkflow = createWorkflow(
  "delete-agreement",
  (input: DeleteAgreementWorkflowInput) => {
    const result = deleteAgreementStep(input);
    return new WorkflowResponse(result);
  }
);
