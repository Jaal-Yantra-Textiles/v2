// src/workflows/create-person-type.ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_TYPE_MODULE } from "../../modules/persontype";
import PersonTypeService from "../../modules/persontype/service";

export type CreatePersonTypeStepInput = {
  name: string;
  description?: string;
};

export const createPersonTypeStep = createStep(
  "create-person-type-step",
  async (input: CreatePersonTypeStepInput, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);
    // Create the PersonType entity
    const newPersonType = await personTypeService.createPersonTypes({
      name: input.name,
      description: input.description,
    });

    // Return the created entity and its ID for potential compensation
    return new StepResponse(newPersonType, newPersonType.id);
  },
  async (id: string, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    // Delete the created entity to compensate
    await personTypeService.deletePersonTypes(id);
  },
);

export type CreatePersonTypeWorkflowInput = {
  name: string;
  description?: string;
};

export const createPersonTypeWorkflow = createWorkflow(
  "create-person-type",
  (input: CreatePersonTypeWorkflowInput) => {
    const newPersonType = createPersonTypeStep(input);

    return new WorkflowResponse(newPersonType);
  },
);
