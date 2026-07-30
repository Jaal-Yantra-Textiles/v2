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

    // Drop keys whose value is undefined. The route always spreads every
    // supported filter (rating/status/submitted_by/reviewed_by), so unset ones
    // arrive as explicit `undefined` — passing those through turns "no filter"
    // into a real constraint and silently narrows the result set.
    const filters = Object.fromEntries(
      Object.entries(input.filters || {}).filter(([, v]) => v !== undefined)
    );

    // Read through query.graph, NOT query.index. The index engine is populated
    // asynchronously, so a feedback that was just created is not yet visible to
    // it — the row existed and was updatable/deletable by id while both read
    // paths (list and get-by-id) reported nothing at all.
    const { data: feedbacks, metadata } = await query.graph({
      entity: "feedback",
      fields,
      filters,
      pagination: {
        skip: input.config?.skip || 0,
        take: input.config?.take || 20,
      },
    });

    // `count` is the total number of matching rows, not the size of this page —
    // it previously returned feedbacks.length, so any paged response reported a
    // total equal to its own page length.
    const count = metadata?.count ?? feedbacks?.length ?? 0;

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
