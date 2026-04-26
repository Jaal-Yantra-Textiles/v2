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
    avatar?: string;
    metadata?: Record<string, unknown>;
  };
};

export const updatePersonStep = createStep(
  "update-person-step",
  async (input: UpdatePersonStepInput, { container }) => {
    console.log('Update input:', input);
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalPerson = await personService.retrievePerson(input.id);
    
    // Create an update object without metadata
    const { metadata, ...updateWithoutMetadata } = input.update;
    
    // Step 1: If we have metadata in the update, first clear existing metadata
    if (metadata !== undefined) {
      console.log('Clearing existing metadata before update');
      await personService.updatePeople({
        selector: {
          id: input.id,
        },
        data: {
          metadata: null,
        }
      });
    }
    
    // Step 2: Perform the actual update with new metadata if provided
    const updateData = {
      ...updateWithoutMetadata,
      ...(metadata !== undefined ? { metadata } : {})
    };
    
    console.log('Final update data:', updateData);
    
    const updatedPerson = await personService.updatePeople({
      selector: {
        id: input.id,
      },
      data: updateData
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
  {name: "update-person", 
    store: true, 
    storeExecution: true
  },

  (input: UpdatePersonStepInput) => {
    const updatedPerson = updatePersonStep(input);
    return new WorkflowResponse(updatedPerson);
  },
);

export default updatePersonWorkflow;
