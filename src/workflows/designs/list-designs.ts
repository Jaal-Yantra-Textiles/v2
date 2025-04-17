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

    const [designs, count] = await designService.listAndCountDesigns(
      input.filters
    );

    return new StepResponse({ designs, count }, null);
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
