import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

import { CRM_MODULE } from "../../modules/crm";

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

export type CreateOpportunityWorkflowInput = CreateOpportunityStepInput;

export const createOpportunityWorkflow = createWorkflow(
  "create-crm-opportunity",
  (input: CreateOpportunityWorkflowInput) => {
    const opportunity = createOpportunityStep(input);
    return new WorkflowResponse(opportunity);
  },
);

export default createOpportunityWorkflow;
