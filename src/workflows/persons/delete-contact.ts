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
      const {
        person_id,
        phone_number, 
        type
      } = originalContact
      await personService.createContactDetails(
        {
          person_id,
          phone_number,
          type
        }
      );
    }
  },
);

export const deleteContactWorkflow = createWorkflow(
 {
  name: 'delete-contact',
  store: true
 },
  (input: DeleteContactWorkFlowInput) => {
    const result = deleteContactStep(input);
    return new WorkflowResponse(result);
  },
);

export default deleteContactWorkflow;
