import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { fetchAgreementResponseStep, updateAgreementResponseStep, updateAgreementStatsStep } from "./steps";

export type UpdateAgreementResponseWebInput = {
  response_id: string;
  access_token: string;
  agreed: boolean;
  response_notes?: string;
  response_ip?: string;
  response_user_agent?: string;
};

export const updateAgreementResponseWebWorkflow = createWorkflow(
  "update-agreement-response-web",
  (input: UpdateAgreementResponseWebInput) => {
    // Step 1: Fetch and validate agreement response with token
    const { agreementResponse, agreement } = fetchAgreementResponseStep({
      response_id: input.response_id,
      access_token: input.access_token,
    });

    // Step 2: Update the agreement response
    const updatedResponse = updateAgreementResponseStep({
      response_id: input.response_id,
      status: input.agreed ? "agreed" : "disagreed",
      agreed: input.agreed,
      responded_at: new Date(),
      response_notes: input.response_notes || null,
      response_ip: input.response_ip || null,
      response_user_agent: input.response_user_agent || null,
    });

    // Step 3: Update agreement statistics
    const updatedStats = updateAgreementStatsStep({
      agreement_id: agreement.id,
    });

    return new WorkflowResponse({
      response: updatedResponse,
      agreement: agreement,
      stats: updatedStats,
    });
  }
);
