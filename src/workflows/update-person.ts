// src/workflows/update-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../modules/person/service";
import { PERSON_MODULE } from "../modules/person";
import { InferTypeOf } from "@medusajs/framework/types"
import Person from "../modules/person/models/person";
export type Person = InferTypeOf<typeof Person>

type UpdatePersonStepInput = {
  id: string;
  update: {
    first_name?: string;
    last_name?: string;
    email?: string;
    date_of_birth?: Date;
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
      data: {
        ...input.update
      }
    }) as unknown as Person;
    return new StepResponse(updatedPerson, originalPerson);
  },
  async (originalPerson, { container }) => {
    if (!originalPerson) return;
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.updatePeople({
      selector: {
        id: originalPerson.id
      },
      data: {
        first_name: originalPerson.first_name, 
        last_name: originalPerson.last_name,
        email: originalPerson.email,
        date_of_birth: originalPerson.date_of_birth,
        metadata: originalPerson.metadata
      }
    });
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
