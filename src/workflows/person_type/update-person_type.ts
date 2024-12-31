// src/workflows/update-person-type.ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_TYPE_MODULE } from "../../modules/persontype";
import PersonTypeService from "../../modules/persontype/service";

export type UpdatePersonTypeStepInput = {
  id: string;
  name?: string;
  description?: string;
};

export const updatePersonTypeStep = createStep(
  "update-person-type-step",
  async (input: UpdatePersonTypeStepInput, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    // Retrieve the current state before updating
    const currentPersonType = await personTypeService.retrievePersonType(
      input.id,
    );

    // Update the PersonType entity
    const updatedPersonType = await personTypeService.updatePersonTypes({
      selector: {
        id: input.id,
      },
      data: {
        name: input.name,
        description: input.description,
      },
    });

    // Return the updated entity and the previous state for compensation
    return new StepResponse(updatedPersonType, currentPersonType);
  },
  async (previousState, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    // Revert to the previous state
    await personTypeService.updatePersonTypes(previousState, {
      name: previousState?.name,
      description: previousState?.description,
    });
  },
);

export type UpdatePersonTypeWorkflowInput = {
  id: string;
  name?: string;
  description?: string;
};

export const updatePersonTypeWorkflow = createWorkflow(
  "update-person-type",
  (input: UpdatePersonTypeWorkflowInput) => {
    const updatedPersonType = updatePersonTypeStep(input);

    return new WorkflowResponse(updatedPersonType);
  },
);
