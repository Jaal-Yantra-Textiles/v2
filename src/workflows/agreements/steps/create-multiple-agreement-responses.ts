import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import { randomBytes } from "crypto";
import AgreementsService from "../../../modules/agreements/service";

export type CreateMultipleAgreementResponsesInput = {
  agreement_id: string;
  signer_data: Array<{
    person_id: string;
    email_sent_to: string;
  }>;
};

export const createMultipleAgreementResponsesStep = createStep(
  "create-multiple-agreement-responses",
  async (input: CreateMultipleAgreementResponsesInput, { container }) => {
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);

    // Prepare batch data for all signers
    const batchData = input.signer_data.map(signer => {
      // Generate a secure access token for web access
      const accessToken = randomBytes(32).toString('hex');
      
      return {
        agreement_id: input.agreement_id,
        email_sent_to: signer.email_sent_to,
        sent_at: new Date(),
        status: "sent" as "sent",
        access_token: accessToken,
      };
    });

    // Create all agreement responses in a single batch call
    const agreementResponses = await agreementsService.createAgreementResponses(batchData);

    return new StepResponse(agreementResponses, agreementResponses.map(r => r.id));
  },
  async (responseIds: string[], { container }) => {
    // Rollback: delete all created agreement responses
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    
    for (const id of responseIds) {
      try {
        await agreementsService.softDeleteAgreementResponses(id);
      } catch (error) {
        // Log error but continue with other rollbacks
        console.error(`Failed to rollback agreement response ${id}:`, error);
      }
    }
  }
);
