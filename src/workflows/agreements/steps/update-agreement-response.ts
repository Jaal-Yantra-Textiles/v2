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

      console.log('=== UPDATE STEP DEBUG ===');
      console.log('Existing status:', existingResponse.status);
      console.log('Requested status:', input.status);

      // Handle status transitions intelligently
      let shouldUpdate = false;
      const updateData: any = {};
      
      // Only update status if it's a valid transition
      if (existingResponse.status === "sent" && input.status === "viewed") {
        // First view - update to viewed
        shouldUpdate = true;
        updateData.status = "viewed";
        if (input.viewed_at) updateData.viewed_at = input.viewed_at;
      } else if ((existingResponse.status === "sent" || existingResponse.status === "viewed") && 
                 (input.status === "agreed" || input.status === "disagreed")) {
        // Response submission - update to agreed/disagreed
        shouldUpdate = true;
        updateData.status = input.status;
        if (input.agreed !== undefined) updateData.agreed = input.agreed;
        if (input.responded_at) updateData.responded_at = input.responded_at;
        if (input.response_notes !== undefined) updateData.response_notes = input.response_notes;
        if (input.response_ip !== undefined) updateData.response_ip = input.response_ip;
        if (input.response_user_agent !== undefined) updateData.response_user_agent = input.response_user_agent;
      } else if (existingResponse.status === input.status) {
        // Same status - no update needed, just return existing
        console.log('Status already set, no update needed');
        return new StepResponse(existingResponse, {
          response_id: input.response_id,
          previous_status: existingResponse.status,
        });
      } else {
        console.log('Invalid status transition, returning existing response');
        return new StepResponse(existingResponse, {
          response_id: input.response_id,
          previous_status: existingResponse.status,
        });
      }

      if (!shouldUpdate) {
        return new StepResponse(existingResponse, {
          response_id: input.response_id,
          previous_status: existingResponse.status,
        });
      }

      
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
