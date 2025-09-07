import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { DESIGN_MODULE } from "../../modules/designs";
import DesignService from "../../modules/designs/service";

export type ListDesignsStepInput = {
  filters?: {
    name?: string;
    design_type?: "Original" | "Derivative" | "Custom" | "Collaboration";
    status?: "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
    priority?: "Low" | "Medium" | "High" | "Urgent";
    tags?: string[];
  };
  pagination: {
    offset: number;
    limit: number;
  };
};

export const listDesignsStep = createStep(
  "list-designs-step",
  async (input: ListDesignsStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);

    // Normalize filters: support partial name search when a simple string is provided
    const filters = { ...(input.filters || {}) } as any
    if (typeof filters.name === "string" && filters.name.trim().length > 0) {
      filters.name = { $ilike: `%${filters.name.trim()}%` }
    }

    const [designs, count] = await designService.listAndCountDesigns(
      filters,
      {
        skip: input.pagination.offset,
        take: input.pagination.limit
      }
    );

    return new StepResponse({ 
      designs, 
      count, 
      offset: input.pagination.offset,
      limit: input.pagination.limit
    }, null);
  },
);

export type ListDesignsWorkFlowInput = ListDesignsStepInput;

export const listDesignsWorkflow = createWorkflow(
  {
    name:'list-designs',
    store: true,
  },
  (input: ListDesignsWorkFlowInput) => {
    const result = listDesignsStep(input);
    return new WorkflowResponse(result);
  },
);

export default listDesignsWorkflow;
