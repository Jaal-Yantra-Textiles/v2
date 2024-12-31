import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type UpdateContactStepInput = {
  id: string;
  person_id: string;
  update: {
    type?: string;
    phone_number?: string;
  };
};

export type UpdateContactWorkFlowInput = {
  id: string;
  person_id: string;
  type?: string;
  phone_number:string;
};

export const updateContactStep = createStep(
  "update-contact-step",
  async (input: UpdateContactStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalContact = await personService.retrieveContactDetail(input.id);
    const updatedContact = await personService.updateContactDetails({
      id: input.id,
      ...input.update,
    });

    return new StepResponse(updatedContact, originalContact);
  },
  async (originalContact, { container }) => {
    // Rollback: restore the original contact if update fails
    if (originalContact) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      await personService.updateContactDetails(originalContact);
    }
  },
);

export const updateContactWorkflow = createWorkflow(
  "update-contact",
  (input: UpdateContactWorkFlowInput) => {
    const result = updateContactStep({
      id: input.id,
      person_id: input.person_id,
      update: {
        type: input.type,
        phone_number: input.phone_number,
      },
    });
    return new WorkflowResponse(result);
  },
);

export default updateContactWorkflow;
