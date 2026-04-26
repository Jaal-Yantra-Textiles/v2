import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk";
import { updateAgreementResponseStep } from "./steps";

export type UpdateAgreementResponseWorkflowInput = {
  response_id: string;
  status: "agreed" | "disagreed" | "viewed";
  agreed?: boolean;
  responded_at?: Date;
  viewed_at?: Date;
  response_notes?: string | null;
  response_ip?: string | null;
  response_user_agent?: string | null;
};

export const updateAgreementResponseWorkflow = createWorkflow(
  "update-agreement-response",
  (input: UpdateAgreementResponseWorkflowInput) => {
    const result = updateAgreementResponseStep(input);
    return new WorkflowResponse(result);
  }
);
