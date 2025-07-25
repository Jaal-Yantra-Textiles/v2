import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { fetchAgreementResponseStep } from "./steps/fetch-agreement-response";
import { updateAgreementResponseStep } from "./steps/update-agreement-response";

export type TrackAgreementViewInput = {
  response_id: string;
  access_token: string;
};

export const trackAgreementViewWorkflow = createWorkflow(
  "track-agreement-view",
  (input: TrackAgreementViewInput) => {
    // Step 1: Fetch and validate agreement response with token
    const { agreementResponse, agreement } = fetchAgreementResponseStep({
      response_id: input.response_id,
      access_token: input.access_token,
    });

    // Step 2: Update view tracking if not already viewed
    const updatedResponse = updateAgreementResponseStep({
      response_id: input.response_id,
      status: agreementResponse.status === "sent" ? "viewed" : 
              (agreementResponse.status === "expired" ? "viewed" : agreementResponse.status as "viewed" | "agreed" | "disagreed"),
      viewed_at: agreementResponse.status === "sent" ? new Date() : undefined,
    });

    return new WorkflowResponse({
      agreement,
      response: updatedResponse,
    });
  }
);
