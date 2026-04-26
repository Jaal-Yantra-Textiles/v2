// src/workflows/delete-person.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../modules/person/service";
import { PERSON_MODULE } from "../modules/person";
import { InferTypeOf } from "@medusajs/framework/types";
import Person from "../modules/person/models/person";
import { console } from "inspector";
export type Person = InferTypeOf<typeof Person>;

type DeletePersonStepInput = {
  id: string;
};

export const deletePersonStep = createStep(
  "delete-person-step",
  async (input: DeletePersonStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const person = await personService.retrievePerson(input.id);
    const deleted = await personService.softDeletePeople({
      id: input.id
    })
    console.log(deleted)
    return new StepResponse(deleted, person);
  },
  async (person, { container }) => {
    // Only create the person if it's defined
    if (person) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      
      // Extract only the base properties that createPeople expects
      // This excludes relationship properties like addresses, contact_details, etc.
      const {
        id,
        first_name,
        last_name,
        email,
        date_of_birth,
        metadata,
        avatar,
        state
      } = person;
      
      // Pass only the expected properties to createPeople
      await personService.createPeople({
        id,
        first_name,
        last_name,
        email,
        date_of_birth,
        metadata,
        avatar,
        state
      });
    }
  },
);

const deletePersonWorkflow = createWorkflow(
  "delete-person",
  (input: DeletePersonStepInput) => {
    const deleted = deletePersonStep(input);
    return new WorkflowResponse(deleted);
  },
);

export default deletePersonWorkflow;
