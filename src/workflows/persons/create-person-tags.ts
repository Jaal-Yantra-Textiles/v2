// src/workflows/create-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  createHook,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_MODULE } from "../../modules/person";
import PersonService from "../../modules/person/service";

type CreatePersonTagsStepInput = {
  name: Record<string, unknown>;
  person_id:string,
};

export const createPersonTagsStep = createStep(
  "create-person-step-tags",
  async (input: CreatePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    
    const personTags = await personService.createTags({
      name: input.name,
      person_id: input.person_id
    });
    return new StepResponse(personTags, personTags.id);
  },
  async (personId, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.deleteTags(personId!);
  },
);

type CreatePersonTagsWorkFlowInput = {
  person_id: string;
  name: Record<string, unknown>;
};

const createPersonTagsWorkflow = createWorkflow(
  "create-person-tags",
  (input: CreatePersonTagsWorkFlowInput) => {
    const personTags = createPersonTagsStep(input);
    const personTagsCreatedHook = createHook(
      "personTagsCreated",
      { 
        personId: input.person_id 
      }
    )
      
    return new WorkflowResponse(personTags, {
      hooks: [personTagsCreatedHook],
    });
  }, 
);

export default createPersonTagsWorkflow;
