import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import AgreementsService from "../../../modules/agreements/service";

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

    try {
      // Fetch the agreement response with agreement relation
      const agreementResponse = await agreementsService.retrieveAgreementResponse(input.response_id, {
        relations: ["agreement"]
      });

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
