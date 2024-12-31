import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type DeleteContactStepInput = {
  person_id: string;
  id: string;
};

export type DeleteContactWorkFlowInput = {
  person_id: string;
  id: string;
};

export const deleteContactStep = createStep(
  "delete-contact-step",
  async (input: DeleteContactStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalContact = await personService.retrieveContactDetail(input.id);
    await personService.deleteContactDetails(input.id);
    return new StepResponse(true, originalContact);
  },
  async (originalContact, { container }) => {
    // Rollback: recreate the contact if deletion fails
    if (originalContact) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      await personService.createContactDetails(originalContact);
    }
  },
);

export const deleteContactWorkflow = createWorkflow(
  "delete-contact",
  (input: DeleteContactWorkFlowInput) => {
    const result = deleteContactStep(input);
    return new WorkflowResponse(result);
  },
);

export default deleteContactWorkflow;
