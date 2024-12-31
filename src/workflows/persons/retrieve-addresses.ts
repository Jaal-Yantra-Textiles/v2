// src/workflows/persons/retrieve-addresses.ts
import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";

type RetrieveAddressesStepInput = {
  person_id: string;
  filters?: Record<string, any>;
  pagination: {
    offset: number;
    limit: number;
  };
};



export const retrieveAddressesStep = createStep(
  "retrieve-addresses-step",
  async (input: RetrieveAddressesStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const addresses = await personService.listAndCountAddresses(input.filters);
    return new StepResponse(addresses);
  }
);

type RetrieveAddressesWorkFlowInput = {
  person_id: string;
  filters?: Record<string, any>;
  pagination: {
    offset: number;
    limit: number;
  };
};

export const retrieveAddressesWorkflow = createWorkflow(
  "retrieve-addresses",
  (input: RetrieveAddressesWorkFlowInput) => {
    const result = retrieveAddressesStep(input);
    return new WorkflowResponse(result);
  },
);

export default retrieveAddressesWorkflow;
