import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../modules/agreements";
import AgreementService from "../../modules/agreements/service";

export type UpdateAgreementStepInput = {
  id: string;
  // TODO: Define optional properties for updating a Agreement from your model
  // Example: name?: string;
};

export const updateAgreementStep = createStep(
  "update-agreement-step",
  async (input: UpdateAgreementStepInput, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    const { id, ...updateData } = input;

    const original = await service.retrieveAgreement(id);

    const updated = await service.updateAgreements({
      selector: { id },
      data: updateData,
    });

    return new StepResponse(updated, { id, originalData: original });
  },
  async (compensationData: { id: string; originalData: any }, { container }) => {
    const service: AgreementService = container.resolve(AGREEMENTS_MODULE);
    await service.updateAgreements({
      selector: { id: compensationData.id },
      data: compensationData.originalData,
    });
  }
);

export type UpdateAgreementWorkflowInput = UpdateAgreementStepInput;

export const updateAgreementWorkflow = createWorkflow(
  "update-agreement",
  (input: UpdateAgreementWorkflowInput) => {
    const result = updateAgreementStep(input);
    return new WorkflowResponse(result);
  }
);
