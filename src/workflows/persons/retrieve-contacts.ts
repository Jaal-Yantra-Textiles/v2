import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type RetrieveContactsStepInput = {
  person_id: string;
  filters?: Record<string, any>;
  pagination: {
    offset: number;
    limit: number;
  };
};

export type RetrieveContactsWorkFlowInput = {
  person_id: string;
  filters?: Record<string, any>;
  pagination: {
    offset: number;
    limit: number;
  };
};

export class RetrieveContactsStepOutput {
  contacts: any[];
  count: number;
}

export const retrieveContactsStep = createStep(
  "retrieve-contacts-step",
  async (input: RetrieveContactsStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const contacts = await personService.listAndCountContactDetails(input.filters);
    return new StepResponse(contacts);
  },
);

export const retrieveContactsWorkflow = createWorkflow(
  "retrieve-contacts",
  (input: RetrieveContactsWorkFlowInput) => {
    const result = retrieveContactsStep(input);
    return new WorkflowResponse(result);
  },
);

export default retrieveContactsWorkflow;
