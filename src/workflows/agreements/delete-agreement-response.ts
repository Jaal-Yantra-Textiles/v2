import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementResponseService from "../../modules/agreements/service";

export type DeleteAgreementResponseStepInput = {
  id: string;
};

export const deleteAgreementResponseStep = createStep(
  "delete-agreement-response-step",
  async (input: DeleteAgreementResponseStepInput, { container }) => {
    const service: AgreementResponseService = container.resolve(AGREEMENTS_MODULE);
    const original = await service.retrieveAgreementResponse(input.id);

    await service.deleteAgreementResponses(input.id);

    return new StepResponse({ success: true }, original);
  },
  async (original: any, { container }) => {
    const service: AgreementResponseService = container.resolve(AGREEMENTS_MODULE);
    await service.createAgreementResponses(original);
  }
);

export type DeleteAgreementResponseWorkflowInput = DeleteAgreementResponseStepInput;

export const deleteAgreementResponseWorkflow = createWorkflow(
  "delete-agreement-response",
  (input: DeleteAgreementResponseWorkflowInput) => {
    const result = deleteAgreementResponseStep(input);
    return new WorkflowResponse(result);
  }
);
