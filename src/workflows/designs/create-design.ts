import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  createHook,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import {
  convertColorPaletteToColors,
  convertCustomSizesToSizeSets,
} from "./helpers/size-set-utils";

type DesignType = "Original" | "Derivative" | "Custom" | "Collaboration";
type DesignStatus = "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold" | "Commerce_Ready";
type PriorityLevel = "Low" | "Medium" | "High" | "Urgent";

type CreateDesignStepInput = {
  name: string;
  description?: string;
  inspiration_sources?: Record<string, any>;
  design_type?: DesignType;
  status?: DesignStatus;
  priority?: PriorityLevel;
  target_completion_date?: null | Date;
  design_files?: Record<string, any>;
  thumbnail_url?: string;
  custom_sizes?: Record<string, any>;
  color_palette?: Record<string, any>;
  tags?: Record<string, any>;
  estimated_cost?: number;
  designer_notes?: string;
  feedback_history?: Record<string, any>;
  metadata?: Record<string, any>;
  // New structured fields (optional)
  colors?: Array<{ name: string; hex_code: string; usage_notes?: string; order?: number }>;
  size_sets?: Array<{ size_label: string; measurements: Record<string, number> }>;
};

export const createDesignStep = createStep(
  "create-design-step",
  async (input: CreateDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    const normalizedSizeSets =
      input.size_sets?.length ? input.size_sets : convertCustomSizesToSizeSets(input.custom_sizes);
    const normalizedColors =
      input.colors?.length ? input.colors : convertColorPaletteToColors(input.color_palette);

    // Create the design record first
    const design = await designService.createDesigns({
      name: input.name,
      description: input.description,
      inspiration_sources: input.inspiration_sources,
      design_type: input.design_type,
      status: input.status,
      priority: input.priority,
      target_completion_date: input.target_completion_date,
      design_files: input.design_files,
      thumbnail_url: input.thumbnail_url,
      custom_sizes: normalizedSizeSets ? null : input.custom_sizes,
      color_palette: normalizedColors ? null : input.color_palette,
      tags: input.tags,
      estimated_cost: input.estimated_cost,
      designer_notes: input.designer_notes,
      feedback_history: input.feedback_history,
      metadata: input.metadata,
    });
    // Persist structured colors if provided
    if (normalizedColors?.length) {
      await designService.createDesignColors(
        normalizedColors.map((c) => ({
          design_id: design.id,
          ...c,
        }))
      );
    }
    // Persist structured size sets if provided
    if (normalizedSizeSets?.length) {
      await designService.createDesignSizeSets(
        normalizedSizeSets.map((s) => ({
          design_id: design.id,
          ...s,
        }))
      );
    }
    return new StepResponse(design, design.id);
  },
  // Compensation function to handle rollback
  async (designId, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    await designService.deleteDesigns(designId!);
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
