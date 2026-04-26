import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { LinkDefinition } from "@medusajs/framework/types";
import { AGREEMENT_RESPONSE_MODULE } from "../../../modules/agreement-responses";
import { PERSON_MODULE } from "../../../modules/person";
import { Link } from "@medusajs/framework/modules-sdk";

export type LinkMultiplePersonsWithAgreementResponsesInput = {
  agreement_response_ids: string[];
  person_ids: string[];
};

export const linkMultiplePersonsWithAgreementResponsesStep = createStep(
  "link-multiple-persons-with-agreement-responses",
  async (input: LinkMultiplePersonsWithAgreementResponsesInput, { container }) => {
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK);

    const links: LinkDefinition[] = [];

    for (let i = 0; i < input.person_ids.length; i++) {
      const linkData: LinkDefinition = {
        [PERSON_MODULE]: {
          person_id: input.person_ids[i],
        },
        [AGREEMENT_RESPONSE_MODULE]: {
          agreement_response_id: input.agreement_response_ids[i],
        },
        data: {
          person_id: input.person_ids[i],
          agreement_response_id: input.agreement_response_ids[i],
        },
      };

      links.push(linkData);
    }

    const createdLinks = await remoteLink.create(links);

    return new StepResponse(createdLinks, links);
  },
  async (rollbackData: LinkDefinition[] | undefined, { container }) => {
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK);

    if (!rollbackData) return;

    try {
      await remoteLink.dismiss(rollbackData);
    } catch (error) {
      console.error("Failed to rollback person-agreement response links:", error);
      throw error;
    }
  }
);
