import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type RetrievePersonTagsStepInput = {
  person_id: string;
};

export type RetrievePersonTagsWorkFlowInput = {
  person_id: string;
};

export const retrievePersonTagsStep = createStep(
  "retrieve-person-tags-step",
  async (input: RetrievePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const tags = await personService.listAndCountTags(input);
    return new StepResponse({
      tags
    });
  },
);

export const retrievePersonTagsWorkflow = createWorkflow(
  "retrieve-person-tags",
  (input: RetrievePersonTagsWorkFlowInput) => {
    const result = retrievePersonTagsStep(input);
    return new WorkflowResponse(result);
  },
);

export default retrievePersonTagsWorkflow;
