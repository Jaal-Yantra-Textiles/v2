import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type UpdatePersonTagsStepInput = {
  person_id: string;
  tags: string[];
};

export type UpdatePersonTagsWorkFlowInput = {
  person_id: string;
  tags: string[];
};

export const updatePersonTagsStep = createStep(
  "update-person-tags-step",
  async (input: UpdatePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalTags = await personService.listTags(input);
    const updatedTags = await personService.updateTags({
      person_id: input.person_id,
      tags: input.tags,
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
