import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { AGREEMENT_RESPONSE_MODULE } from "../../../modules/agreement-responses";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import AgreementResponseService from "../../../modules/agreement-responses/service";
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
    const agreementResponseService: AgreementResponseService = container.resolve(AGREEMENT_RESPONSE_MODULE);
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Query;

    // Retrieve the agreement response (no ORM relations - separate module now)
    const agreementResponse = await agreementResponseService.retrieveAgreementResponse(input.response_id);

    if (agreementResponse.access_token !== input.access_token) {
      throw new MedusaError(
        MedusaError.Types.UNAUTHORIZED,
        "Invalid access token"
      );
    }

    // Fetch the agreement separately using the agreement_id field
    const [agreement] = await agreementsService.listAgreements(
      { id: [agreementResponse.agreement_id] }
    );

    if (!agreement) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Agreement ${agreementResponse.agreement_id} not found`
      );
    }

    if (agreement.valid_until && new Date() > new Date(agreement.valid_until)) {
      throw new MedusaError(
        MedusaError.Types.NOT_ALLOWED,
        "Agreement has expired and is no longer available"
      );
    }

    // Resolve person through the response link
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
