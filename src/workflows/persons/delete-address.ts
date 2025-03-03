import PersonService from "../../modules/person/service";
import { PERSON_MODULE } from "../../modules/person";
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk";

export type DeleteAddressStepInput = {
  person_id: string;
  id: string;
};

export type DeleteAddressWorkFlowInput = {
  person_id: string;
  id: string;
};

export const deleteAddressStep = createStep(
  "delete-address-step",
  async (input: DeleteAddressStepInput, { container }) => {
    const personService: PersonService = container.resolve(PERSON_MODULE);
    
    const originalAddress = await personService.retrieveAddress(input.id);
    await personService.deleteAddresses(input.id);

    return new StepResponse(true, originalAddress);
  },
  async (originalAddress, { container }) => {
    // Rollback: recreate the address if deletion fails
    if (originalAddress) {
      const personService: PersonService = container.resolve(PERSON_MODULE);
      
      // Extract only the properties needed for recreating the address
      const {
        id,
        street,
        city,
        state,
        postal_code,
        country,
        person_id
      } = originalAddress;
      
      // Use the person_id instead of the full person object
      await personService.createAddresses({
        id,
        street,
        city,
        state,
        postal_code,
        country,
        person_id
      });
    }
  },
);

export const deleteAddressWorkflow = createWorkflow(
  "delete-address",
  (input: DeleteAddressWorkFlowInput) => {
    const result = deleteAddressStep(input);
    return new WorkflowResponse(result);
  },
);

export default deleteAddressWorkflow;
