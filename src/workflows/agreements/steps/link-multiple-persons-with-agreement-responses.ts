import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { LinkDefinition } from "@medusajs/framework/types";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import { PERSON_MODULE } from "../../../modules/person";

export type LinkMultiplePersonsWithAgreementResponsesInput = {
  agreement_response_ids: string[];
  person_ids: string[];
};

export const linkMultiplePersonsWithAgreementResponsesStep = createStep(
  "link-multiple-persons-with-agreement-responses",
  async (input: LinkMultiplePersonsWithAgreementResponsesInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    // Create links for all persons with their corresponding agreement responses
    const links: LinkDefinition[] = [];
    
    // Assuming person_ids and agreement_response_ids are in the same order
    for (let i = 0; i < input.person_ids.length; i++) {
      const linkData: LinkDefinition = {
        [PERSON_MODULE]: {
          person_id: input.person_ids[i],
        },
        [AGREEMENTS_MODULE]: {
          agreement_response_id: input.agreement_response_ids[i],
        },
        data: {
          person_id: input.person_ids[i],
          agreement_response_id: input.agreement_response_ids[i],
        },
      };
      
      links.push(linkData);
    }
    
    // Create all links at once
    const createdLinks = await remoteLink.create(links);
    
    return new StepResponse(createdLinks, links);
  },
  async (rollbackData: LinkDefinition[], { container }) => {
    // Rollback: remove all person-agreement response links
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    try {
      await remoteLink.dismiss(rollbackData);
    } catch (error) {
      console.error("Failed to rollback person-agreement response links:", error);
      throw error;
    }
  }
);
