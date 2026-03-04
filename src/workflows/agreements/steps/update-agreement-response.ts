import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import AgreementsService from "../../../modules/agreements/service";

export const updateAgreementResponseStep = createStep(
  "update-agreement-response",
  async (
    input: {
      response_id: string;
      status: "agreed" | "disagreed" | "viewed";
      agreed?: boolean;
      responded_at?: Date;
      viewed_at?: Date;
      response_notes?: string | null;
      response_ip?: string | null;
      response_user_agent?: string | null;
    },
    { container }
  ) => {
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);

    // retrieveAgreementResponse throws MedusaError.NOT_FOUND if the record doesn't exist
    const existingResponse = await agreementsService.retrieveAgreementResponse(input.response_id);

    const updateData: Record<string, any> = {};
    let shouldUpdate = false;

    if (existingResponse.status === "sent" && input.status === "viewed") {
      shouldUpdate = true;
      updateData.status = "viewed";
      if (input.viewed_at) updateData.viewed_at = input.viewed_at;
    } else if (
      (existingResponse.status === "sent" || existingResponse.status === "viewed") &&
      (input.status === "agreed" || input.status === "disagreed")
    ) {
      shouldUpdate = true;
      updateData.status = input.status;
      if (input.agreed !== undefined) updateData.agreed = input.agreed;
      if (input.responded_at) updateData.responded_at = input.responded_at;
      if (input.response_notes !== undefined) updateData.response_notes = input.response_notes;
      if (input.response_ip !== undefined) updateData.response_ip = input.response_ip;
      if (input.response_user_agent !== undefined) updateData.response_user_agent = input.response_user_agent;
    }

    if (!shouldUpdate) {
      return new StepResponse(existingResponse, {
        response_id: input.response_id,
        previous_status: existingResponse.status,
      });
    }

    const updatedResponses = await agreementsService.updateAgreementResponses({
      selector: { id: input.response_id },
      data: updateData,
    });

    return new StepResponse(updatedResponses[0], {
      response_id: input.response_id,
      previous_status: existingResponse.status,
    });
  },
  async (compensationData: { response_id: string; previous_status: string } | undefined, { container }) => {
    if (!compensationData) return;

    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);

    await agreementsService.updateAgreementResponses({
      selector: { id: compensationData.response_id },
      data: {
        status: compensationData.previous_status as any,
        agreed: null,
        responded_at: null,
        response_notes: null,
        response_ip: null,
        response_user_agent: null,
      },
    });
  }
);
