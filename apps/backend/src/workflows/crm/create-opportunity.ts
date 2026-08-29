import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { CRM_MODULE } from "../../modules/crm";
import { CRM_EXTERNAL_SYSTEM } from "../../modules/crm/lead-to-crm";
import { SOCIALS_MODULE } from "../../modules/socials";

type CreateOpportunityStepInput = {
  title: string;
  stage?: string;
  amount?: number | null;
  currency?: string;
  expected_close_date?: string | null;
  company_id?: string | null;
  owner_person_id?: string | null;
  metadata?: Record<string, any>;
};

export const createOpportunityStep = createStep(
  "create-crm-opportunity-step",
  async (input: CreateOpportunityStepInput, { container }) => {
    const service: any = container.resolve(CRM_MODULE);
    const opportunity = await service.createCrmOpportunities(input);
    return new StepResponse(opportunity, opportunity.id);
  },
  async (opportunityId, { container }) => {
    const service: any = container.resolve(CRM_MODULE);
    await service.deleteCrmOpportunities(opportunityId!);
  },
);

/**
 * Move the originating lead to `qualified` (#1552).
 *
 * 🔴 The lead-import route names this exact act and had nothing to defer to:
 *
 *   > Promoting a lead is the act of working it, so it stops being `new`.
 *   > Deliberately NOT `qualified`: importing a contact is not a judgement
 *   > that the deal is real — that is what opening an opportunity means.
 *
 * The reasoning was right and the act did not exist, so a lead was imported,
 * became `contacted`, and the trail ended: no lead could ever reach
 * `qualified`. Opening a deal IS that judgement, so this is where it belongs.
 *
 * The link back to the lead is `external_id` — the import route writes the CRM
 * person's id onto the lead. There is no opportunity → lead reference, and this
 * deliberately does not invent one: the contact is the join.
 *
 * ⚠️ Best-effort by design. A lead that cannot be found, a socials module that
 * is unavailable, or a lead already past `qualified` must not fail the deal —
 * the opportunity is the thing the user asked for, and the lead status is
 * bookkeeping that follows it.
 */
export const qualifyOriginatingLeadStep = createStep(
  "qualify-originating-lead-step",
  async (input: { owner_person_id?: string | null }, { container }) => {
    if (!input.owner_person_id) return new StepResponse(null);

    try {
      const socials: any = container.resolve(SOCIALS_MODULE);
      const leads = await socials.listLeads({
        external_system: CRM_EXTERNAL_SYSTEM,
        external_id: input.owner_person_id,
      });

      /**
       * Only leads not already at or past this point. Re-stamping a `won` lead
       * as `qualified` would walk it BACKWARDS — a second deal for a contact is
       * a normal thing to open, and it must not undo the first one's outcome.
       */
      const toQualify = (leads || []).filter(
        (l: any) => l?.status !== "qualified" && l?.status !== "won"
      );
      if (!toQualify.length) return new StepResponse(null);

      await socials.updateLeads(
        toQualify.map((l: any) => ({ id: l.id, status: "qualified" }))
      );

      // Remember what each was, so compensation restores it rather than
      // guessing at "contacted".
      return new StepResponse(
        toQualify.map((l: any) => ({ id: l.id, status: l.status })),
        toQualify.map((l: any) => ({ id: l.id, status: l.status }))
      );
    } catch {
      return new StepResponse(null);
    }
  },
  async (previous, { container }) => {
    if (!previous?.length) return;
    try {
      const socials: any = container.resolve(SOCIALS_MODULE);
      await socials.updateLeads(previous);
    } catch {
      // Nothing further to do — the opportunity is already being rolled back.
    }
  },
);

export type CreateOpportunityWorkflowInput = CreateOpportunityStepInput;

export const createOpportunityWorkflow = createWorkflow(
  "create-crm-opportunity",
  (input: CreateOpportunityWorkflowInput) => {
    const opportunity = createOpportunityStep(input);
    // Opening a deal is the judgement that the lead was real.
    qualifyOriginatingLeadStep({ owner_person_id: input.owner_person_id });
    return new WorkflowResponse(opportunity);
  },
);

export default createOpportunityWorkflow;
