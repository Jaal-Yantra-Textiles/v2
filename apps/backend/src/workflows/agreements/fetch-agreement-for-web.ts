import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
import { fetchAgreementResponseStep } from "./steps";

export type FetchAgreementForWebInput = {
  response_id: string;
  access_token: string;
};

export const fetchAgreementForWebWorkflow = createWorkflow(
  "fetch-agreement-for-web",
  (input: FetchAgreementForWebInput) => {
    // Step 1: Fetch and validate agreement response with token
    const { agreementResponse, agreement } = fetchAgreementResponseStep({
      response_id: input.response_id,
      access_token: input.access_token,
    });

    return new WorkflowResponse({
      agreement,
      response: agreementResponse,
    });
  }
);
