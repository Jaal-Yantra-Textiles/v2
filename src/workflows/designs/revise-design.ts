import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { MedusaError } from "@medusajs/utils"
import { LinkDefinition } from "@medusajs/framework/types"
import type { IEventBusModuleService } from "@medusajs/types"
import type { Link } from "@medusajs/modules-sdk"
import DesignService from "../../modules/designs/service"
import { DESIGN_MODULE } from "../../modules/designs"
import { PARTNER_MODULE } from "../../modules/partner"

// ─── Types ─────────────────────────────────────────────────────────────────

type ReviseDesignInput = {
  design_id: string
  revision_notes: string
  overrides?: Record<string, unknown>
}

type DesignColor = {
  id: string
  name: string
  hex_code: string
  usage_notes: string | null
  order: number | null
  metadata: Record<string, unknown> | null
}

type DesignSizeSet = {
  id: string
  size_label: string
  measurements: Record<string, number> | null
  metadata: Record<string, unknown> | null
}

type DesignSpecification = {
  id: string
  title: string
  category: string
  details: string
  measurements: Record<string, unknown> | null
  materials_required: Record<string, unknown> | null
  special_instructions: string | null
  attachments: Record<string, unknown> | null
  version: string
  status: string
  reviewer_notes: string | null
}

type DesignComponent = {
  id: string
  component_design_id: string
  quantity: number
  role: string | null
  notes: string | null
  order: number
}

type DesignPartner = {
  id: string
  name: string
}

type OriginalDesign = {
  id: string
  name: string
  description: string
  inspiration_sources: string[] | null
  design_type: string
  status: string
  priority: string
  origin_source: string
  target_completion_date: Date | null
  design_files: Record<string, unknown> | null
  thumbnail_url: string | null
  custom_sizes: Record<string, unknown> | null
  color_palette: Record<string, unknown> | null
  tags: string[] | null
  estimated_cost: number | null
  material_cost: number | null
  production_cost: number | null
  cost_breakdown: Record<string, unknown> | null
  cost_currency: string | null
  designer_notes: string | null
  feedback_history: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  media_files: Record<string, unknown> | null
  moodboard: Record<string, unknown> | null
  revised_from_id: string | null
  revision_number: number
  revision_notes: string | null
  colors: DesignColor[]
  size_sets: DesignSizeSet[]
  specifications: DesignSpecification[]
  components: DesignComponent[]
  partners: DesignPartner[]
}

const REVISABLE_STATUSES = [
  "Approved",
  "Commerce_Ready",
  "In_Development",
  "Sample_Production",
  "Technical_Review",
]

// ─── Steps ─────────────────────────────────────────────────────────────────

// Step 1: Fetch the original design with all related data
const getOriginalDesignStep = createStep(
  "get-original-design-step",
  async (input: { design_id: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data: [design] } = await query.graph({
      entity: "design",
      fields: [
        "*",
        "specifications.*",
        "colors.*",
        "size_sets.*",
        "components.*",
        "partners.*",
      ],
      filters: { id: input.design_id },
    })

    if (!design) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design ${input.design_id} not found`
      )
    }

    return new StepResponse(design as unknown as OriginalDesign)
  }
)

// Step 2: Validate the design can be revised
const validateCanReviseStep = createStep(
  "validate-can-revise-step",
  async (input: { design: OriginalDesign }) => {
    const { design } = input

    if (!REVISABLE_STATUSES.includes(design.status)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Design cannot be revised from status "${design.status}". Must be one of: ${REVISABLE_STATUSES.join(", ")}`
      )
    }

    if (design.status === "Superseded") {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Design has already been superseded. Revise the latest version instead.`
      )
    }

    return new StepResponse(true)
  }
)

// Step 3: Clone the design into a new revision
const cloneDesignStep = createStep(
  "clone-design-step",
  async (
    input: {
      original: OriginalDesign
      revision_notes: string
      overrides?: Record<string, unknown>
    },
    { container }
  ) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    const { original, revision_notes, overrides } = input

    const newDesignData = {
      name: original.name,
      description: original.description,
      inspiration_sources: original.inspiration_sources,
      design_type: original.design_type,
      status: "In_Development" as const,
      priority: original.priority,
      origin_source: original.origin_source,
      target_completion_date: original.target_completion_date,
      design_files: original.design_files,
      thumbnail_url: original.thumbnail_url,
      custom_sizes: original.custom_sizes,
      color_palette: original.color_palette,
      tags: original.tags,
      estimated_cost: original.estimated_cost,
      material_cost: original.material_cost,
      production_cost: original.production_cost,
      cost_breakdown: original.cost_breakdown,
      cost_currency: original.cost_currency,
      designer_notes: original.designer_notes,
      feedback_history: original.feedback_history,
      metadata: original.metadata,
      media_files: original.media_files,
      moodboard: original.moodboard,
      // Revision tracking
      revised_from_id: original.id,
      revision_number: (original.revision_number || 1) + 1,
      revision_notes,
      // Apply overrides
      ...overrides,
    }

    const newDesign = await designService.createDesigns(newDesignData as Record<string, unknown>)

    // Clone colors
    if (original.colors?.length) {
      await designService.createDesignColors(
        original.colors.map((c: DesignColor) => ({
          design_id: newDesign.id,
          name: c.name,
          hex_code: c.hex_code,
          usage_notes: c.usage_notes,
          order: c.order,
          metadata: c.metadata,
        }))
      )
    }

    // Clone size sets
    if (original.size_sets?.length) {
      await designService.createDesignSizeSets(
        original.size_sets.map((s: DesignSizeSet) => ({
          design_id: newDesign.id,
          size_label: s.size_label,
          measurements: s.measurements,
          metadata: s.metadata,
        }))
      )
    }

    // Clone specifications
    if (original.specifications?.length) {
      for (const spec of original.specifications) {
        await designService.createDesignSpecifications({
          design_id: newDesign.id,
          title: spec.title,
          category: spec.category as "Measurements" | "Materials" | "Construction" | "Finishing" | "Packaging" | "Quality" | "Other",
          details: spec.details,
          measurements: spec.measurements,
          materials_required: spec.materials_required,
          special_instructions: spec.special_instructions,
          attachments: spec.attachments,
          version: spec.version,
          status: "Draft" as const,
          reviewer_notes: null,
        })
      }
    }

    // Clone components
    if (original.components?.length) {
      await designService.createDesignComponents(
        original.components.map((comp: DesignComponent) => ({
          parent_design_id: newDesign.id,
          component_design_id: comp.component_design_id,
          quantity: comp.quantity,
          role: comp.role,
          notes: comp.notes,
          order: comp.order,
        }))
      )
    }

    return new StepResponse(newDesign, newDesign.id)
  },
  async (newDesignId, { container }) => {
    if (!newDesignId) return
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    await designService.deleteDesigns(newDesignId)
  }
)

// Step 4: Mark the original design as Superseded
const supersedeOriginalStep = createStep(
  "supersede-original-step",
  async (input: { design_id: string }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)

    const original = await designService.retrieveDesign(input.design_id)
    const previousStatus = original.status

    await designService.updateDesigns({
      selector: { id: input.design_id },
      data: { status: "Superseded" },
    })

    return new StepResponse(null, { design_id: input.design_id, previousStatus })
  },
  async (data, { container }) => {
    if (!data) return
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    await designService.updateDesigns({
      selector: { id: data.design_id },
      data: { status: data.previousStatus },
    })
  }
)

// Step 5: Copy partner links to the new design
const copyPartnerLinksStep = createStep(
  "copy-partner-links-step",
  async (
    input: { original_design_id: string; new_design_id: string; partner_ids: string[] },
    { container }
  ) => {
    if (!input.partner_ids.length) {
      return new StepResponse([])
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.partner_ids.map((partnerId) => ({
      [DESIGN_MODULE]: { design_id: input.new_design_id },
      [PARTNER_MODULE]: { partner_id: partnerId },
    }))

    await remoteLink.create(links)
    return new StepResponse(links, links)
  },
  async (links, { container }) => {
    if (!links?.length) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(links)
  }
)

// Step 6: Emit the design.revised event
const emitDesignRevisedStep = createStep(
  "emit-design-revised-step",
  async (
    input: {
      original_design_id: string
      new_design_id: string
      revision_notes: string
      partner_ids: string[]
    },
    { container }
  ) => {
    const eventBus = container.resolve(Modules.EVENT_BUS) as IEventBusModuleService
    await eventBus.emit({
      name: "design.revised",
      data: {
        original_design_id: input.original_design_id,
        new_design_id: input.new_design_id,
        revision_notes: input.revision_notes,
        partner_ids: input.partner_ids,
      },
    })
    return new StepResponse(undefined)
  }
)

// ─── Workflow ──────────────────────────────────────────────────────────────

export const reviseDesignWorkflow = createWorkflow(
  "revise-design",
  (input: ReviseDesignInput) => {
    const original = getOriginalDesignStep({ design_id: input.design_id })

    validateCanReviseStep({ design: original })

    const newDesign = cloneDesignStep({
      original,
      revision_notes: input.revision_notes,
      overrides: input.overrides,
    })

    supersedeOriginalStep({ design_id: input.design_id })

    const partnerIds = transform(
      { original },
      (data: { original: OriginalDesign }) => {
        return (data.original.partners || []).map((p) => p.id)
      }
    )

    copyPartnerLinksStep({
      original_design_id: input.design_id,
      new_design_id: newDesign.id,
      partner_ids: partnerIds,
    })

    emitDesignRevisedStep({
      original_design_id: input.design_id,
      new_design_id: newDesign.id,
      revision_notes: input.revision_notes,
      partner_ids: partnerIds,
    })

    return new WorkflowResponse(newDesign)
  }
)

export default reviseDesignWorkflow
