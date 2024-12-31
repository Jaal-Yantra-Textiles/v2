// src/workflows/create-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { PERSON_MODULE } from "../../modules/person";
import PersonService from "../../modules/person/service";

type CreatePersonTagsStepInput = {
  name: string[];
  person_id:string,
};

export const createPersonTagsStep = createStep(
  "create-person-step-tags",
  async (input: CreatePersonTagsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    console.log(input)
    const personTags = await personService.createTags({
      name: input.name,
      person_id: input.person_id
    });
    return new StepResponse(personTags, personTags.id);
  },
  async (personId, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.deleteTags(personId);
  },
);

type CreatePersonTagsWorkFlowInput = {
  person_id: string;
  name: string[];
};

const createPersonWorkflow = createWorkflow(
  "create-person-tags",
  (input: CreatePersonTagsWorkFlowInput) => {
    const personTags = createPersonTagsStep(input);
    return new WorkflowResponse(personTags);
  }, 
);

export default createPersonWorkflow;
