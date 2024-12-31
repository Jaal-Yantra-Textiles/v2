// src/workflows/delete-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../modules/person/service";
import { PERSON_MODULE } from "../modules/person";

type DeletePersonStepInput = {
  id: string;
};

export const deletePersonStep = createStep(
  "delete-person-step",
  async (input: DeletePersonStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const person = await personService.retrievePerson(input.id);
    await personService.deletePeople(input.id);
    return new StepResponse(null, person);
  },
  async (personData, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.createPeople(personData);
  },
);

const deletePersonWorkflow = createWorkflow(
  "delete-person",
  (input: DeletePersonStepInput) => {
    deletePersonStep(input);
  },
);

export default deletePersonWorkflow;
