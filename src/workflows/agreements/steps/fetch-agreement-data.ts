import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export const fetchAgreementDataStep = createStep(
  "fetch-agreement-data",
  async (input: { agreement_id: string; person_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    
    // Fetch agreement and person data using query
    const { data: agreements } = await query.graph({
      entity: "agreement",
      fields: ["*"],
      filters: { id: input.agreement_id },
    });
    
    const { data: persons } = await query.graph({
      entity: "person",
      fields: ["*"],
      filters: { id: input.person_id },
    });
    
    const agreement = agreements?.[0];
    const person = persons?.[0];

    if (!agreement) {
      throw new Error(`Agreement with ID ${input.agreement_id} not found`);
    }
    if (!person) {
      throw new Error(`Person with ID ${input.person_id} not found`);
    }
    if (!person.email) {
      throw new Error(`Person with ID ${input.person_id} does not have an email address`);
    }

    return new StepResponse({
      agreement,
      person: {
        id: person.id,
        email: person.email,
        first_name: person.first_name,
        last_name: person.last_name,
      } as any,
    });
  }
);
