// src/workflows/create-address.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createHook } from "@medusajs/framework/workflows-sdk";
import { emitEventStep } from "@medusajs/medusa/core-flows";

type CreateAddressStepInput = {
  person_id: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  latitude: number;
  longitude: number;
};

export const createAddressStep = createStep(
  "create-address-step",
  async (input: CreateAddressStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const address = await personService.createAddresses(input);
    return new StepResponse(address, address.id);
  },
  async (addressId, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.deleteAddresses(addressId!);
  },
);

type CreateAddressWorkFlowInput = {
  person_id: string;
  street: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  latitude: number;
  longitude: number;
};

export const createAddressWorkflow = createWorkflow(
  "create-address",
  (input: CreateAddressWorkFlowInput) => {
    const address = createAddressStep(input);

    emitEventStep({
      eventName: "person_address.created",
      data: {
        id: address.id,
      },
    });

    const personAddressCreatedHook = createHook(
      "personAddressCreated",
      {
        personId: address.person_id,
      }
    );
    return new WorkflowResponse(address, {
      hooks: [personAddressCreatedHook],
    });
  }
);

export default createAddressWorkflow;
