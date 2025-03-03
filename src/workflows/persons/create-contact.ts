import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export enum ContactType {
  MOBILE = "mobile",
  HOME = "home",
  WORK = "work"
}

export type CreateContactStepInput = {
  person_id: string;
  type: ContactType;
  value: string;
  is_primary?: boolean;
};

export type CreateContactWorkFlowInput = {
  person_id: string;
  type: ContactType;
  value: string;
  is_primary?: boolean;
};

export const createContactStep = createStep(
  "create-contact-step",
  async (input: CreateContactStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const contact = await personService.createContactDetails(input)
    return new StepResponse(contact, contact.id);
  },
  async (contactId, { container }) => {
    // Rollback: delete the contact if creation fails
    const personService: PersonService = container.resolve(PERSON_MODULE);
    await personService.deleteContactDetails(contactId!);
  },
);

export const createContactWorkflow = createWorkflow(
  "create-contact",
  (input: CreateContactWorkFlowInput) => {
    const result = createContactStep(input);
    return new WorkflowResponse(result);
  },
);

export default createContactWorkflow;
