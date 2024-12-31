// src/workflows/list-person-types.ts
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_TYPE_MODULE } from "../../modules/persontype";
import PersonTypeService from "../../modules/persontype/service";

export type ListPersonTypesStepInput = {
  filters?: Record<string, any>;
};

export const listPersonTypesStep = createStep(
  "list-person-types-step",
  async (input: ListPersonTypesStepInput, { container }) => {
    const personTypeService: PersonTypeService =
      container.resolve(PERSON_TYPE_MODULE);

    const personTypes = await personTypeService.listAndCountPersonTypes(
      input.filters,
    );

    return new StepResponse(personTypes, null);
  },
);

export type ListPersonTypesWorkFlowInput = {
  filters?: Record<string, any>;
  pagination: {
    offset: number;
    limit: number;
  };
};

export const listPersonTypeWorkflow = createWorkflow(
  "list-person-type",
  (input: ListPersonTypesWorkFlowInput) => {
    const listPersonType = listPersonTypesStep(input);

    return new WorkflowResponse(listPersonType);
  },
);
