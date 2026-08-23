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
import { normalizeProductType } from "../../modules/designs/lib/product-type";

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
  cost_currency?: string;
  designer_notes?: string;
  feedback_history?: Record<string, any>;
  metadata?: Record<string, any>;
  moodboard?: Record<string, any>;
  // New structured fields (optional)
  colors?: Array<{ name: string; hex_code: string; usage_notes?: string; order?: number }>;
  size_sets?: Array<{ size_label: string; measurements: Record<string, number> }>;
  /**
   * #938. Setting this through the API is a HUMAN naming the garment, so it is
   * stamped `manual` and inference will not overwrite it afterwards. Pass null
   * to clear the type and hand it back to inference.
   */
  product_type?: string | null;
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
      product_type,
      ...designFields
    } = input;

    // Only process colors/size_sets when explicitly provided in the request
    const colorsProvided = "colors" in input || "color_palette" in input;
    const sizeSetsProvided = "size_sets" in input || "custom_sizes" in input;

    const normalizedSizeSets = sizeSetsProvided
      ? (size_sets?.length ? size_sets : convertCustomSizesToSizeSets(custom_sizes))
      : undefined;
    const normalizedColors = colorsProvided
      ? (colors?.length ? colors : convertColorPaletteToColors(color_palette))
      : undefined;

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

    // #938 — normalise the garment type and record that a human set it, so the
    // inference step refuses to overwrite it later (see mayInferOver). Pulled
    // out of the generic spread above on purpose: passed straight through it
    // would be stored exactly as typed, and "Kurta " and "kurta" would be two
    // types to everything that groups by it. An explicit null clears both
    // columns and hands the design back to inference.
    if (typeof product_type !== "undefined") {
      if (product_type === null) {
        updateData.product_type = null;
        updateData.product_type_source = null;
      } else {
        const normalized = normalizeProductType(product_type);
        updateData.product_type = normalized;
        updateData.product_type_source = normalized ? "manual" : null;
      }
    }

    const design = await designService.updateDesigns({
      selector: {
        id,
      },
      data: {
        ...updateData,
      },
    });
    // Upsert structured colors only when explicitly provided in the request
    if (colorsProvided && normalizedColors) {
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
    // Upsert structured size sets only when explicitly provided in the request
    if (sizeSetsProvided && normalizedSizeSets) {
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
