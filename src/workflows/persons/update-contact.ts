import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { ContactType } from "./create-contact";
import { InferTypeOf } from "@medusajs/framework/types"
import Contact from "../../modules/person/models/person_contact"
export type Contact =  InferTypeOf<typeof Contact>

export type UpdateContactStepInput = {
  id: string;
  person_id: string;
  update: {
    type?: ContactType;
    phone_number?: string;
  };
};

export type UpdateContactWorkFlowInput = {
  id: string;
  person_id: string;
  type?: ContactType;
  phone_number:string;
};

export const updateContactStep = createStep(
  "update-contact-step",
  async (input: UpdateContactStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    const originalContact = await personService.retrieveContactDetail(input.id);
    const updatedContact = await personService.updateContactDetails({
     selector: {
      id: input.id
     },
     data: {
      ...input.update
     }
    }) as unknown as Contact;

    return new StepResponse(updatedContact, originalContact);
  },
  async (originalContact, { container }) => {
    // Rollback: restore the original contact if update fails
    if (!originalContact) {
      return
    }
    const personService: PersonService = container.resolve(PERSON_MODULE);
      await personService.updateContactDetails({
        selector: {
          id: originalContact.id
        },
        data: {
          person_id: originalContact.person_id,
          type: originalContact.type,
          phone_number: originalContact.phone_number
        },
      });
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
