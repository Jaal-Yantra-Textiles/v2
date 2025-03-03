// src/workflows/persons/update-address.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { InferTypeOf } from "@medusajs/framework/types";
import Address from "../../modules/person/models/person_address";
export type Address = InferTypeOf<typeof Address>;

type UpdateAddressStepInput = {
  id: string;
  person_id: string;
  update: {
    street?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    metadata?: Record<string, any>;
  };
};

export const updateAddressStep = createStep(
  "update-address-step",
  async (input: UpdateAddressStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalAddress = await personService.retrieveAddress(input.id) as unknown as Address;
    const updatedAddress = await personService.updateAddresses({
      selector: {
        id: input.id,
      },
      data: input.update,
    })

    return new StepResponse(updatedAddress, originalAddress);
  },
  async (originalAddress, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    if (originalAddress){
      await personService.updateAddresses({
        selector: {
          id: originalAddress.id,
        },
        data: {
          person_id: originalAddress.person_id,
          city: originalAddress.city,
          country: originalAddress.country,
          postal_code: originalAddress.postal_code,
          state: originalAddress.state,
          street: originalAddress.street
        },
      });
    } 
  }
);

export const updateAddressWorkflow = createWorkflow(
  "update-address",
  (input: UpdateAddressStepInput) => {
    const result = updateAddressStep(input);
    return new WorkflowResponse(result);
  },
);

export default updateAddressWorkflow;
