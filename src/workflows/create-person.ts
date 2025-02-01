// src/workflows/create-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../modules/person/service";
import { PERSON_MODULE } from "../modules/person";

type CreatePersonStepInput = {
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth?: string; // Optional field
  metadata?: Record<string, any>; // Optional field for additional data
};

export const createPersonStep = createStep(
  "create-person-step",
  async (input: CreatePersonStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const person = await personService.createPeople(input);
    return new StepResponse(person, person.id);
  },
  async (personId, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.deletePeople(personId);
  },
);

export type CreatePersonWorkFlowInput = {
  first_name: string;
  last_name: string;
  email: string;
  date_of_birth?: string; // Optional field
  metadata?: Record<string, any>;
};
export const createPersonWorkflow = createWorkflow(
  "create-person",
  (input: CreatePersonWorkFlowInput) => {
    const person = createPersonStep(input);
    return new WorkflowResponse(person);
  },
);

export default createPersonWorkflow;
