import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { AGREEMENTS_MODULE } from "../../../modules/agreements";
import AgreementsService from "../../../modules/agreements/service";

export const updateAgreementStatsStep = createStep(
  "update-agreement-stats",
  async (input: { agreement_id: string }, { container }) => {
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    const query:any = container.resolve(ContainerRegistrationKeys.QUERY);

    // Get current agreement
    const { data: agreements } = await query.graph({
      entity: "agreement",
      fields: ["*"],
      filters: { id: input.agreement_id },
    });
    
    const agreement = agreements?.[0];
    if (!agreement) {
      throw new Error(`Agreement with ID ${input.agreement_id} not found`);
    }
    
    // Update sent count
    const updatedAgreement = await agreementsService.updateAgreements({
      id: input.agreement_id,
      sent_count: (agreement.sent_count || 0) + 1,
    });

    return new StepResponse(
      updatedAgreement,
      { agreement_id: input.agreement_id, previous_count: agreement.sent_count || 0 }
    );
  },
  async (rollbackData: { agreement_id: string; previous_count: number }, { container }) => {
    // Rollback: restore previous sent count
    if (!rollbackData.agreement_id) {
      return;
    }
    const agreementsService: AgreementsService = container.resolve(AGREEMENTS_MODULE);
    
    await agreementsService.updateAgreements({
      id: rollbackData.agreement_id,
      sent_count: rollbackData.previous_count,
    });
  }
);
