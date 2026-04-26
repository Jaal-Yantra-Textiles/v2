import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { InferTypeOf } from "@medusajs/framework/types"
import Tags from "../../modules/person/models/person_tags"
export type Tags = InferTypeOf<typeof Tags>;

export type UpdatePersonTagsStepInput = {
  person_id: string;
  name: Record<string, unknown>;
};

export type UpdatePersonTagsWorkFlowInput = {
  person_id: string;
  name: Record<string, unknown>;
};

export const updatePersonTagsStep = createStep(
  "update-person-tags-step",
  async (input: UpdatePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    
    const originalTags = await personService.listTags(input) as unknown as Tags;
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
    if (!originalTags) {
      return
    }
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.updateTags({
      selector: {
        id: originalTags
      },
      data: {
        person_id: originalTags.person_id,
        name: originalTags.name,
      }
    });
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
