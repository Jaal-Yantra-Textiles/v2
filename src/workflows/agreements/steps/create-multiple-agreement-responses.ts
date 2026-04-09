import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { AGREEMENT_RESPONSE_MODULE } from "../../../modules/agreement-responses";
import { randomBytes } from "crypto";
import AgreementResponseService from "../../../modules/agreement-responses/service";

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
    const agreementResponseService: AgreementResponseService = container.resolve(AGREEMENT_RESPONSE_MODULE);

    // Prepare batch data for all signers
    const batchData = input.signer_data.map(signer => {
      const accessToken = randomBytes(32).toString('hex');

      return {
        agreement_id: input.agreement_id,
        email_sent_to: signer.email_sent_to,
        sent_at: new Date(),
        status: "sent" as "sent",
        access_token: accessToken,
      };
    });

    const agreementResponses = await agreementResponseService.createAgreementResponses(batchData);

    return new StepResponse(agreementResponses, agreementResponses.map(r => r.id));
  },
  async (responseIds: string[] | undefined, { container }) => {
    if (!responseIds) return;
    const agreementResponseService: AgreementResponseService = container.resolve(AGREEMENT_RESPONSE_MODULE);

    for (const id of responseIds || []) {
      try {
        await agreementResponseService.softDeleteAgreementResponses(id);
      } catch (error) {
        console.error(`Failed to rollback agreement response ${id}:`, error);
      }
    }
  }
);
