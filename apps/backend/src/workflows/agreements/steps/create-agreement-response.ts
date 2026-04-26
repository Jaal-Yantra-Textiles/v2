import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { AGREEMENT_RESPONSE_MODULE } from "../../../modules/agreement-responses";
import { randomBytes } from "crypto";
import AgreementResponseService from "../../../modules/agreement-responses/service";

export const createAgreementResponseStep = createStep(
  "create-agreement-response",
  async (
    input: {
      agreement_id: string;
      person_id: string;
      email_sent_to: string;
    },
    { container }
  ) => {
    const agreementResponseService: AgreementResponseService = container.resolve(AGREEMENT_RESPONSE_MODULE);

    // Generate a secure access token for web access
    const accessToken = randomBytes(32).toString('hex');

    const agreementResponse = await agreementResponseService.createAgreementResponses({
      agreement_id: input.agreement_id,
      email_sent_to: input.email_sent_to,
      sent_at: new Date(),
      status: "sent",
      access_token: accessToken,
    });

    return new StepResponse({
      id: agreementResponse.id,
      access_token: agreementResponse.access_token,
      agreement_id: agreementResponse.agreement_id,
      email_sent_to: agreementResponse.email_sent_to,
      status: agreementResponse.status,
    } as any, agreementResponse.id);
  },
  async (agreementResponseId: string, { container }) => {
    // Rollback: delete the created agreement response
    const agreementResponseService: AgreementResponseService = container.resolve(AGREEMENT_RESPONSE_MODULE);
    await agreementResponseService.softDeleteAgreementResponses(agreementResponseId);
  }
);
