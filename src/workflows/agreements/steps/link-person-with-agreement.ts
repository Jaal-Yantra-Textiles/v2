import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { LinkDefinition } from "@medusajs/framework/types";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import { PERSON_MODULE } from "../../../modules/person";

export const linkPersonWithAgreementStep = createStep(
  "link-person-with-agreement",
  async (input: { person_id: string; agreement_id: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    const links: LinkDefinition[] = [];
    links.push({
      [PERSON_MODULE]: {
        person_id: input.person_id,
      },
      [AGREEMENTS_MODULE]: {
        agreement_id: input.agreement_id,
      },
      data: {
        person_id: input.person_id,
        agreement_id: input.agreement_id,
      },
    });
    
    await remoteLink.create(links);
    return new StepResponse(links, { person_id: input.person_id, agreement_id: input.agreement_id });
  },
  async (rollbackData: { person_id: string; agreement_id: string }, { container }) => {
    // Rollback: remove the person-agreement link
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);
    
    await remoteLink.dismiss([
      {
        [PERSON_MODULE]: {
          person_id: rollbackData.person_id,
        },
        [AGREEMENTS_MODULE]: {
          agreement_id: rollbackData.agreement_id,
        },
      },
    ]);
  }
);
