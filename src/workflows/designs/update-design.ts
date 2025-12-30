import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";
import {
  convertColorPaletteToColors,
  convertCustomSizesToSizeSets,
} from "./helpers/size-set-utils";

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
  moodboard?: Record<string, any>;
  // New structured fields (optional)
  colors?: Array<{ name: string; hex_code: string; usage_notes?: string; order?: number }>;
  size_sets?: Array<{ size_label: string; measurements: Record<string, number> }>;
};

export const updateDesignStep = createStep(
  "update-design-step",
  async (input: UpdateDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    // Store the original design data for compensation
    const originalDesign = await designService.retrieveDesign(input.id);

    const {
      id,
      colors,
      size_sets,
      custom_sizes,
      color_palette,
      ...designFields
    } = input;

    const normalizedSizeSets =
      size_sets?.length ? size_sets : convertCustomSizesToSizeSets(custom_sizes);
    const normalizedColors =
      colors?.length ? colors : convertColorPaletteToColors(color_palette);

    const updateData = Object.entries(designFields).reduce<Record<string, any>>(
      (acc, [key, value]) => {
        if (typeof value !== "undefined") {
          acc[key] = value;
        }
        return acc;
      },
      {}
    );

    if (normalizedSizeSets?.length) {
      updateData.custom_sizes = null;
    } else if (typeof custom_sizes !== "undefined") {
      updateData.custom_sizes = custom_sizes;
    }
    if (normalizedColors?.length) {
      updateData.color_palette = null;
    } else if (typeof color_palette !== "undefined") {
      updateData.color_palette = color_palette;
    }

    const design = await designService.updateDesigns({
      selector: {
        id,
      },
      data: {
        ...updateData,
      },
    });
    // Upsert structured colors if provided
    if (normalizedColors) {
      // Delete existing colors for this design
      const existing = await designService.listDesignColors({ design_id: id });
      if (existing.length) {
        await designService.deleteDesignColors(existing.map((c) => c.id));
      }
      // Create new colors
      if (normalizedColors.length) {
        await designService.createDesignColors(
          normalizedColors.map((c) => ({
            design_id: id,
            ...c,
          }))
        );
      }
    }
    // Upsert structured size sets if provided
    if (normalizedSizeSets) {
      const existing = await designService.listDesignSizeSets({ design_id: id });
      if (existing.length) {
        await designService.deleteDesignSizeSets(existing.map((s) => s.id));
      }
      if (normalizedSizeSets.length) {
        await designService.createDesignSizeSets(
          normalizedSizeSets.map((s) => ({
            design_id: id,
            ...s,
          }))
        );
      }
    }
    return new StepResponse(design, { id, originalData: originalDesign });
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
