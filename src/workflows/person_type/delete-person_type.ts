// src/workflows/delete-person-type.ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_TYPE_MODULE } from "../../modules/persontype";
import PersonTypeService from "../../modules/persontype/service";

export type DeletePersonTypeStepInput = {
  id: string;
};

export const deletePersonTypeStep = createStep(
  "delete-person-type-step",
  async (input: DeletePersonTypeStepInput, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    // Retrieve the current state before deletion
    const personTypeToDelete = await personTypeService.retrievePersonType(
      input.id,
    );

    // Delete the PersonType entity
    await personTypeService.deletePersonTypes(input.id);

    // Return the previous state for potential restoration
    return new StepResponse(null, personTypeToDelete);
  },
  async (previousState, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    // Restore the deleted entity
    await personTypeService.createPersonTypes({
      id: previousState?.id,
      name: previousState?.name,
      description: previousState?.description,
    });
  },
);

export type DeletePersonTypeWorkflowInput = {
  id: string;
};

export const deletePersonTypeWorkflow = createWorkflow(
  "delete-person-type",
  (input: DeletePersonTypeWorkflowInput) => {
    deletePersonTypeStep(input);

    return new WorkflowResponse(null);
  },
);
