import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import AgreementsService from "../../../modules/agreements/service";
import PersonAgreementLink  from "../../../links/person-agreements";
import { RemoteQueryFunction } from "@medusajs/types";
type Query = Omit<RemoteQueryFunction, symbol>
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

    try {
      // Fetch the agreement response with agreement relation
      const agreementResponse = await agreementsService.retrieveAgreementResponse(input.response_id, {
        relations: ["agreement"]
      });

      const { data: linkedData } = await query.graph({
        entity: PersonAgreementLink.entryPoint,
        fields: ["*"],
        filters: { agreement_id: agreementResponse.agreement_id },
      });
      
      const { data: persons  } = await query.graph({
        entity: 'person',
        fields: ["*"],
        filters: { id: linkedData[0].person_id },
      });
      
      const person = persons && persons.length > 0 ? persons[0] : null;

      if (!agreementResponse) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Agreement response not found"
        );
      }

      // Validate the access token
      if (agreementResponse.access_token !== input.access_token) {
        throw new MedusaError(
          MedusaError.Types.UNAUTHORIZED,
          "Invalid access token"
        );
      }

      const agreement = agreementResponse.agreement;

      // Check if agreement has expired
      if (agreement.valid_until && new Date() > new Date(agreement.valid_until)) {
        throw new MedusaError(
          MedusaError.Types.NOT_ALLOWED,
          "Agreement has expired and is no longer available"
        );
      }

      return new StepResponse({
        agreementResponse,
        agreement,
        person,
      });

    } catch (error) {
      if (error instanceof MedusaError) {
        throw error;
      }
      
      throw new MedusaError(
        MedusaError.Types.DB_ERROR,
        `Failed to fetch agreement response: ${error.message}`
      );
    }
  }
);
