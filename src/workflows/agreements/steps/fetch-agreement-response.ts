import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import AgreementsService from "../../../modules/agreements/service";
import PersonAgreementResponseLink from "../../../links/person-agreement-responses";
import { RemoteQueryFunction } from "@medusajs/types";

type Query = Omit<RemoteQueryFunction, symbol>;

export const fetchAgreementResponseStep = createStep(
  "fetch-agreement-response",
  async (
    input: {
      response_id: string;
      access_token: string;
    },
    { container }
  ) => {
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query;

    // retrieveAgreementResponse throws MedusaError.NOT_FOUND if the record doesn't exist
    const agreementResponse = await agreementsService.retrieveAgreementResponse(input.response_id, {
      relations: ["agreement"],
    });

    if (agreementResponse.access_token !== input.access_token) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "Invalid access token"
      );
    }

    const agreement = agreementResponse.agreement;

    if (agreement.valid_until && new Date() > new Date(agreement.valid_until)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Agreement has expired and is no longer available"
      );
    }

    // Resolve person through the response link (not the agreement link)
    const { data: linkedData } = await query.graph({
      entity: PersonAgreementResponseLink.entryPoint,
      fields: ["person.*"],
      filters: { agreement_response_id: agreementResponse.id },
    });

    const person = linkedData && linkedData.length > 0
      ? linkedData[0].person
      : null;

    return new StepResponse({
      agreementResponse,
      agreement,
      person,
    });
  }
);
