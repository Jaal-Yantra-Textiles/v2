import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementResponseService from "../../modules/agreements/service";

export type UpdateAgreementResponseStepInput = {
  id: string;
  // TODO: Define optional properties for updating a AgreementResponse from your model
  // Example: name?: string;
};

export const updateAgreementResponseStep = createStep(
  "update-agreement-response-step",
  async (input: UpdateAgreementResponseStepInput, { container }) => {
    const service: AgreementResponseService = container.resolve(AGREEMENTS_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveAgreementResponse(id);

    const updated = await service.updateAgreementResponses({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: AgreementResponseService = container.resolve(AGREEMENTS_MODULE);
    await service.updateAgreementResponses({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateAgreementResponseWorkflowInput = UpdateAgreementResponseStepInput;

export const updateAgreementResponseWorkflow = createWorkflow(
  "update-agreement-response",
  (input: UpdateAgreementResponseWorkflowInput) => {
    const result = updateAgreementResponseStep(input);
    return new WorkflowResponse(result);
  }
);
