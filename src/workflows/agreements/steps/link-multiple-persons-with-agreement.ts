import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { LinkDefinition } from "@medusajs/framework/types";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import { PERSON_MODULE } from "../../../modules/person";

export type LinkMultiplePersonsWithAgreementInput = {
  agreement_id: string;
  person_ids: string[];
};

export const linkMultiplePersonsWithAgreementStep = createStep(
  "link-multiple-persons-with-agreement",
  async (input: LinkMultiplePersonsWithAgreementInput, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    // Create links for all persons
    const links: LinkDefinition[] = [];
    
    for (const person_id of input.person_ids) {
      const linkData: LinkDefinition = {
        [PERSON_MODULE]: {
          person_id: person_id,
        },
        [AGREEMENTS_MODULE]: {
          agreement_id: input.agreement_id,
        },
        data: {
          person_id: person_id,
          agreement_id: input.agreement_id,
        },
      };
      
      links.push(linkData);
    }
    
    // Create all links at once
    const createdLinks = await remoteLink.create(links);
    
    return new StepResponse(createdLinks, links);
  },
  async (rollbackData: LinkDefinition[], { container }) => {
    // Rollback: remove all person-agreement links
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    try {
      await remoteLink.dismiss(rollbackData);
    } catch (error) {
      console.error("Failed to rollback person-agreement links:", error);
      throw error;
    }
  }
);
