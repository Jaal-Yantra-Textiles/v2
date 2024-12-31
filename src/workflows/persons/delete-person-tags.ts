import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type DeletePersonTagsStepInput = {
  person_id: string;
  tag_ids: string[];
};

export type DeletePersonTagsWorkFlowInput = {
  person_id: string;
  tag_ids: string[];
};

export const deletePersonTagsStep = createStep(
  "delete-person-tags-step",
  async (input: DeletePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalTags = await personService.listTags(input);
    await personService.deleteTags({
      person_id: input.person_id,
      tag_ids: input.tag_ids,
    });

    return new StepResponse(true, originalTags);
  },
  async (originalTags, { container }) => {
    // Rollback: restore deleted tags if deletion fails
    if (originalTags) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      await personService.createTags(originalTags);
    }
  },
);

export const deletePersonTagsWorkflow = createWorkflow(
  "delete-person-tags",
  (input: DeletePersonTagsWorkFlowInput) => {
    const result = deletePersonTagsStep(input);
    return new WorkflowResponse(result);
  },
);

export default deletePersonTagsWorkflow;
