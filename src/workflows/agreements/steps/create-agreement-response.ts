import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";

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
    const agreementsService = container.resolve(AGREEMENTS_MODULE);

    const agreementResponse = await agreementsService.createAgreementResponses({
      agreement_id: input.agreement_id,
      email_sent_to: input.email_sent_to,
      sent_at: new Date(),
      status: "sent",
    });

    return new StepResponse(agreementResponse, agreementResponse.id);
  },
  async (agreementResponseId: string, { container }) => {
    // Rollback: delete the created agreement response
    const agreementsService = container.resolve(AGREEMENTS_MODULE);
    await agreementsService.softDeleteAgreementResponses(agreementResponseId);
  }
);
