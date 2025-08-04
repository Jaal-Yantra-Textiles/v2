import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export type FetchMultiplePersonsDataInput = {
  person_ids: string[];
};

export const fetchMultiplePersonsDataStep = createStep(
  "fetch-multiple-persons-data",
  async (input: FetchMultiplePersonsDataInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    
    // Fetch persons data using query
    const { data: persons } = await query.graph({
      entity: "person",
      fields: ["*"],
      filters: { 
        id: input.person_ids 
      },
    });
    
    if (!persons || persons.length === 0) {
      throw new Error(`No persons found with the provided IDs`);
    }
    
    // Verify all requested persons were found
    const foundPersonIds = persons.map((p: any) => p.id);
    const missingPersonIds = input.person_ids.filter(id => !foundPersonIds.includes(id));
    
    if (missingPersonIds.length > 0) {
      throw new Error(`Persons with IDs ${missingPersonIds.join(', ')} not found`);
    }
    
    // Verify all persons have email addresses
    const personsWithoutEmail = persons.filter((p: any) => !p.email);
    
    if (personsWithoutEmail.length > 0) {
      throw new Error(`Persons with IDs ${personsWithoutEmail.map((p: any) => p.id).join(', ')} do not have email addresses`);
    }
    
    return new StepResponse(persons);
  }
);
