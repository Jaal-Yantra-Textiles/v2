import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { InferTypeOf } from "@medusajs/framework/types"
import Tags from "../../modules/person/models/person_tags"
export type Tags = InferTypeOf<typeof Tags>;

export type DeletePersonTagsStepInput = {
  person_id: string;
  id: string;
};

export type DeletePersonTagsWorkFlowInput = {
  person_id: string;
  id: string;
};

export const deletePersonTagsStep = createStep(
  "delete-person-tags-step",
  async (input: DeletePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalTags = await personService.listTags(input) as unknown as Tags;
   
    await personService.deleteTags({
      id: input.id
    });

    return new StepResponse(true, originalTags);
  },
  async (originalTags, { container }) => {
    // Rollback: restore deleted tags if deletion fails
    if (originalTags) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
     
      await personService.createTags({
        person_id: originalTags.person_id,
        name: originalTags.name,
      });
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
