import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  when,
  transform,
} from "@medusajs/framework/workflows-sdk";
import DesignService from "../../modules/designs/service";
import { DESIGN_MODULE } from "../../modules/designs";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  convertColorPaletteToColors,
  convertCustomSizesToSizeSets,
} from "./helpers/size-set-utils";
import { normalizeProductType } from "../../modules/designs/lib/product-type";
import { inferDesignProductTypeStep } from "./infer-design-product-type";
import type { Link } from "@medusajs/modules-sdk";
import type { IEventBusModuleService } from "@medusajs/types";

type DesignType = "Original" | "Derivative" | "Custom" | "Collaboration";
type DesignStatus = "Conceptual" | "In_Development" | "Technical_Review" | "Sample_Production" | "Revision" | "Approved" | "Rejected" | "On_Hold" | "Commerce_Ready" | "Superseded";
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
  cost_currency?: string;
  designer_notes?: string;
  feedback_history?: Record<string, any>;
  metadata?: Record<string, any>;
  media_files?: Array<{ id?: string; url: string; isThumbnail?: boolean }>;
  moodboard?: Record<string, any>;
  // New structured fields (optional)
  colors?: Array<{ name: string; hex_code: string; usage_notes?: string; order?: number }>;
  size_sets?: Array<{ size_label: string; measurements: Record<string, number> }>;
  /**
   * The garment this design is (#938) — "trousers", "saree". Normalised on
   * write. When omitted, the workflow infers it; when given, it is treated as
   * MANUAL and no model may overwrite it.
   */
  product_type?: string | null;
  origin_source?: "manual" | "ai-mistral" | "ai-other";
  customer_id_for_link?: string;
  // Roadmap #6: set when a partner creates the design for their own
  // pipeline. Null/undefined for admin-created designs.
  owner_partner_id?: string | null;
};

export const createDesignStep = createStep(
  "create-design-step",
  async (input: CreateDesignStepInput, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    const normalizedSizeSets =
      input.size_sets?.length ? input.size_sets : convertCustomSizesToSizeSets(input.custom_sizes);
    const normalizedColors =
      input.colors?.length ? input.colors : convertColorPaletteToColors(input.color_palette);
    const normalizedProductType = normalizeProductType(input.product_type);

    // Create the design record first
    // Note: media_files is typed as json() in the model, so we cast the array to the expected type
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
      cost_currency: input.cost_currency,
      designer_notes: input.designer_notes,
      feedback_history: input.feedback_history,
      metadata: input.metadata,
      media_files: input.media_files as Record<string, unknown> | null | undefined,
      moodboard: input.moodboard,
      origin_source: input.origin_source,
      owner_partner_id: input.owner_partner_id ?? null,
      // A type supplied by the caller is a HUMAN's word, so it is stamped
      // `manual` and inference will refuse to overwrite it (see
      // mayInferOver). An unusable string normalises to null rather than
      // being stored bent, and the inference step then fills it in.
      product_type: normalizedProductType,
      product_type_source: normalizedProductType ? "manual" : null,
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

const linkDesignToCustomerStep = createStep(
  "link-design-to-customer-step",
  async (input: { design_id: string; customer_id: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    await remoteLink.create({
      [DESIGN_MODULE]: { design_id: input.design_id },
      [Modules.CUSTOMER]: { customer_id: input.customer_id },
    });
    return new StepResponse(null, input);
  },
  async (input, { container }) => {
    if(!input) {
      return
    }
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link;
    await remoteLink.dismiss({
      [DESIGN_MODULE]: { design_id: input.design_id },
      [Modules.CUSTOMER]: { customer_id: input.customer_id },
    });
  }
);

const emitDesignAssignedStep = createStep(
  "emit-design-assigned",
  async (
    input: { design_id: string; customer_id: string; design_name: string; design_status?: string },
    { container }
  ) => {
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventBus.emit({
      name: "design.assigned",
      data: {
        design_id: input.design_id,
        customer_id: input.customer_id,
        design_name: input.design_name,
        design_status: input.design_status,
      },
    })
    return new StepResponse(undefined)
  }
)

/**
 * Re-read the design after inference so the CREATE response tells the truth.
 *
 * `createDesignStep` returns the row as it was BEFORE the type was inferred, so
 * without this a caller creating a design gets back `product_type: null` for a
 * design that has one — an API that lies about what it just did, and a test
 * that would pass while it lied.
 */
const readDesignStep = createStep(
  "read-design-after-create-step",
  async (input: { design_id: string }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE);
    const design = await designService.retrieveDesign(input.design_id);
    return new StepResponse(design);
  }
);

export const createDesignWorkflow = createWorkflow(
  "create-design",
  (input: CreateDesignWorkFlowInput) => {
    const design = createDesignStep(input);

    when({ input, design }, ({ input }) => Boolean(input.customer_id_for_link)).then(
      () => {
        linkDesignToCustomerStep({
          design_id: design.id,
          customer_id: input.customer_id_for_link!,
        })

        const eventPayload = transform({ input, design }, (data) => ({
          design_id: data.design.id,
          customer_id: data.input.customer_id_for_link!,
          design_name: data.design.name,
          design_status: data.design.status,
        }))

        emitDesignAssignedStep(eventPayload)
      }
    );

    // #938 — a design with no type cannot have a production spec derived, and
    // therefore cannot become a draft product (#939). Infer one when the caller
    // did not supply it.
    //
    // 🔑 The step swallows every failure and reports `skipped` instead of
    // throwing, so a model outage cannot stop a designer saving their work. It
    // is placed AFTER the customer link deliberately: the cheap, certain writes
    // land first, and the uncertain one is last.
    when({ input, design }, ({ input }) =>
      !normalizeProductType(input.product_type)
    ).then(() => {
      inferDesignProductTypeStep({ design_id: design.id })
    });

    return new WorkflowResponse(readDesignStep({ design_id: design.id }));
  },
);

export default createDesignWorkflow;
