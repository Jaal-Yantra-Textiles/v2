// src/workflows/update-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../modules/person/service";
import { PERSON_MODULE } from "../modules/person";

type UpdatePersonStepInput = {
  id: string;
  update: {
    first_name?: string;
    last_name?: string;
    email?: string;
    date_of_birth?: string;
    metadata?: Record<string, any>;
  };
};

export const updatePersonStep = createStep(
  "update-person-step",
  async (input: UpdatePersonStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalPerson = await personService.retrievePerson(input.id);
    const updatedPerson = await personService.updatePeople({
      selector: {
        id: input.id,
      },
      data: input.update,
    });
    return new StepResponse(updatedPerson, originalPerson);
  },
  async (originalPerson, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.updatePeople(originalPerson);
  },
);

const updatePersonWorkflow = createWorkflow(
  "update-person",
  (input: UpdatePersonStepInput) => {
    const updatedPerson = updatePersonStep(input);
    return new WorkflowResponse(updatedPerson);
  },
);

export default updatePersonWorkflow;
