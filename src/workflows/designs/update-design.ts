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
  inspiration_sources?: Record<string, any>;
  design_type?: DesignType;
  status?: DesignStatus;
  priority?: PriorityLevel;
  media_files?: Record<string, any>;
  target_completion_date?: Date;
  design_files?: Record<string, any>;
  thumbnail_url?: string;
  custom_sizes?: Record<string, any>;
  color_palette?: Record<string, any>;
  tags?: Record<string, any>;
  estimated_cost?: number;
  designer_notes?: string;
  feedback_history?: Record<string, any>;
  metadata?: Record<string, any>;
};

export const updateDesignStep = createStep(
  "update-design-step",
  async (input: UpdateDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    // Store the original design data for compensation
    const originalDesign = await designService.retrieveDesign(input.id);
  
    const design = await designService.updateDesigns({
      selector: {
        id: input.id,
      },
      data: {
        ...input,
      },
    });
    return new StepResponse(design, { id: input.id, originalData: originalDesign });
  },
  // Compensation function to restore original state
  async (data: { id: string; originalData: any }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.updateDesigns({
      selector: {
        id: data.id,
      },
      data: data.originalData,
    });
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
