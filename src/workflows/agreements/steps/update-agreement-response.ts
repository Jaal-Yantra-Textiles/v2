import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { MedusaError } from "@medusajs/framework/utils";
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

    try {
      // Check if response already exists and validate current status
      const existingResponse = await agreementsService.retrieveAgreementResponse(input.response_id);
      
      if (!existingResponse) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          "Agreement response not found"
        );
      }

    //   // Check if already responded (for web submissions)
    //   if (input.status === "agreed" || input.status === "disagreed") {
    //     if (existingResponse.status === "agreed" || existingResponse.status === "disagreed") {
    //       throw new MedusaError(
    //         MedusaError.Types.NOT_ALLOWED,
    //         "You have already responded to this agreement"
    //       );
    //     }
    //   }

      // Update the agreement response
      const updateData: any = {
        status: input.status,
      };
      
      if (input.agreed !== undefined) updateData.agreed = input.agreed;
      if (input.responded_at) updateData.responded_at = input.responded_at;
      if (input.viewed_at) updateData.viewed_at = input.viewed_at;
      if (input.response_notes !== undefined) updateData.response_notes = input.response_notes;
      if (input.response_ip !== undefined) updateData.response_ip = input.response_ip;
      if (input.response_user_agent !== undefined) updateData.response_user_agent = input.response_user_agent;
      
      const updatedResponses = await agreementsService.updateAgreementResponses({
        selector: { id: input.response_id },
        data: updateData
      });

      const updatedResponse = updatedResponses[0];

      return new StepResponse(updatedResponse, {
        response_id: input.response_id,
        previous_status: existingResponse.status,
      });

    } catch (error) {
      if (error instanceof MedusaError) {
        throw error;
      }
      
      throw new MedusaError(
        MedusaError.Types.DB_ERROR,
        `Failed to update agreement response: ${error.message}`
      );
    }
  },
  async (compensationData: { response_id: string; previous_status: string }, { container }) => {
    // Rollback: restore previous status
    if(!compensationData){
        return
    }
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    
    try {
      await agreementsService.updateAgreementResponses({
        selector: { id: compensationData.response_id },
        data: {
          status: compensationData.previous_status as any,
          agreed: null,
          responded_at: null,
          response_notes: null,
          response_ip: null,
          response_user_agent: null,
        }
      });
    } catch (error) {
      console.error("Failed to rollback agreement response update:", error);
    }
  }
);
