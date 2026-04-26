import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import type { RemoteQueryFunction } from "@medusajs/types";

export type ListFeedbackStepInput = {
  filters?: Record<string, any>;
  config?: {
    skip?: number;
    take?: number;
    select?: string[];
    relations?: string[];
  };
  includeLinks?: {
    partners?: boolean;
    tasks?: boolean;
    inventoryOrders?: boolean;
  };
};

export const listFeedbackStep = createStep(
  "list-feedback-step",
  async (input: ListFeedbackStepInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as Omit<RemoteQueryFunction, symbol>;

    // Build fields array based on what links to include
    const fields = ["*"];
    
    if (input.includeLinks?.partners) {
      fields.push("partner.*");
    }
    if (input.includeLinks?.tasks) {
      fields.push("tasks.*");
    }
    if (input.includeLinks?.inventoryOrders) {
      fields.push("inventory_orders.*");
    }

    // Query feedbacks with linked entities
    const { data: feedbacks } = await query.index({
      entity: "feedback",
      fields,
      filters: input.filters || {},
      pagination: {
        skip: input.config?.skip || 0,
        take: input.config?.take || 20,
      },
    });

    const count = feedbacks?.length || 0;

    return new StepResponse([feedbacks || [], count]);
  }
);

export type ListFeedbackWorkflowInput = ListFeedbackStepInput;

export const listFeedbackWorkflow = createWorkflow(
  "list-feedback",
  (input: ListFeedbackWorkflowInput) => {
    const results = listFeedbackStep(input);
    return new WorkflowResponse(results);
  }
);
