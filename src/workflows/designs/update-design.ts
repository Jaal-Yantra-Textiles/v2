import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";

type DesignType = "Original" | "Derivative" | "Custom" | "Collaboration";
type DesignStatus = "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold";
type PriorityLevel = "Low" | "Medium" | "High" | "Urgent";

type UpdateDesignStepInput = {
  id: string;
  name?: string;
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

export const updateDesignStep = createStep(
  "update-design-step",
  async (input: UpdateDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    // Store the original design data for compensation
    const originalDesign = await designService.retrieveDesign(input.id);
    console.log(input)
    const design = await designService.updateDesigns({
      selector: {
        id: input.id,
      },
      data: {
        ...input,
      },
    });
    console.log(originalDesign,design)
    return new StepResponse(design, { id: input.id, originalData: originalDesign });
  },
  // Compensation function to restore original state
  async (data: { id: string; originalData: any }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.updateDesigns(data.id, data.originalData);
  }
);

type UpdateDesignWorkFlowInput = UpdateDesignStepInput;

export const updateDesignWorkflow = createWorkflow(
  "update-design",
  (input: UpdateDesignWorkFlowInput) => {
    const design = updateDesignStep(input);
    return new WorkflowResponse(design);
  },
);

export default updateDesignWorkflow;
