import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type UpdatePersonTagsStepInput = {
  person_id: string;
  name: string[];
};

export type UpdatePersonTagsWorkFlowInput = {
  person_id: string;
  name: string[];
};

export const updatePersonTagsStep = createStep(
  "update-person-tags-step",
  async (input: UpdatePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    console.log(input)
    const originalTags = await personService.listTags(input);
    const updatedTags = await personService.updateTags({
      selector:{
        person_id: input.person_id
      },
      data: {
        name: input.name
      }
    });

    return new StepResponse(updatedTags, originalTags);
  },
  async (originalTags, { container }) => {
    // Rollback: restore original tags if update fails
    if (originalTags) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      await personService.updateTags(originalTags);
    }
  },
);

export const updatePersonTagsWorkflow = createWorkflow(
  "update-person-tags",
  (input: UpdatePersonTagsWorkFlowInput) => {
    const result = updatePersonTagsStep(input);
    return new WorkflowResponse(result);
  },
);

export default updatePersonTagsWorkflow;
