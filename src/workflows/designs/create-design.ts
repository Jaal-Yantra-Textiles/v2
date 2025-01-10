import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

type DesignType = "Original" | "Derivative" | "Custom" | "Collaboration";
type DesignStatus = "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
type PriorityLevel = "Low" | "Medium" | "High" | "Urgent";

type CreateDesignStepInput = {
  name: string;
  description?: string;
  inspiration_sources?: string[];
  design_type?: DesignType;
  status?: DesignStatus;
  priority?: PriorityLevel;
  target_completion_date?: Date;
  design_files?: string[];
  thumbnail_url?: string;
  custom_sizes?: Record<string, any>;
  color_palette?: Array<{
    name: string;
    code: string;
  }>;
  tags?: string[];
  estimated_cost?: number;
  designer_notes?: string;
  feedback_history?: Array<{
    date: Date;
    feedback: string;
    author: string;
  }>;
  metadata?: Record<string, any>;
};

export const createDesignStep = createStep(
  "create-design-step",
  async (input: CreateDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    const design = await designService.createDesigns(input);
    return new StepResponse(design, design.id);
  },
  // Compensation function to handle rollback
  async (designId, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.deleteDesigns(designId);
  },
);

type CreateDesignWorkFlowInput = CreateDesignStepInput;

export const createDesignWorkflow = createWorkflow(
  "create-design",
  (input: CreateDesignWorkFlowInput) => {
    const design = createDesignStep(input);
    return new WorkflowResponse(design);
  },
);

export default createDesignWorkflow;
