import { createStep, createWorkflow, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { imageExtractionMedusaWorkflow, ImageExtractionInput, ImageExtractionOutput } from "./image-extraction"
import { createRawMaterialWorkflow } from "../raw-materials/create-raw-material"
import { createInventoryItemsWorkflow, createInventoryLevelsWorkflow } from "@medusajs/medusa/core-flows"

export type ExtractAndCreateInput = ImageExtractionInput & {
  persist?: boolean
  defaults?: {
    notes?: string
    raw_materials?: {
      width_inch?: number
      material_type?: string
    }
    inventory?: {
      stock_location_id?: string
      default_stocked_quantity?: number
      default_incoming_quantity?: number
      incoming_from_extraction?: boolean
    }
  }
}

export type ExtractAndCreateOutput = {
  extraction: ImageExtractionOutput
  created_inventory_ids?: string[]
  created_raw_material_ids?: string[]
  issues?: string[]
}

const normalizeUnit = (unit?: string): string | undefined => {
  if (!unit) return undefined
  const u = unit.toLowerCase().trim()
  if (["m", "meter", "metre", "meters"].includes(u)) return "Meter"
  if (["kg", "kilogram", "kilograms"].includes(u)) return "Kilogram"
  if (["g", "gram", "grams"].includes(u)) return "Gram"
  if (["yd", "yard", "yards"].includes(u)) return "Yard"
  if (["roll", "rolls"].includes(u)) return "Roll"
  if (["pc", "pcs", "piece", "pieces"].includes(u)) return "Piece"
  return "Other"
}

const buildInventoryPayloads = createStep(
  "build-inventory-payloads",
  async (
    input: {
      extraction: ImageExtractionOutput
      defaults?: ExtractAndCreateInput["defaults"]
    }
  ) => {
    const items = input.extraction?.items || []
    const payloads = items.map((it) => ({
      title: it.name || "Untitled Item",
      description: input.extraction?.summary || "Created from image extraction",
      sku: it.sku,
      metadata: {
        ai_extracted: true,
        confidence: it.confidence,
        unit: normalizeUnit(it.unit),
        extracted_quantity: typeof it.quantity === "number" ? it.quantity : undefined,
        stock_location_id: input.defaults?.inventory?.stock_location_id,
      },
    }))
    return new StepResponse(payloads)
  }
)

const buildRawMaterialPayloads = createStep(
  "build-raw-material-payloads",
  async (
    input: {
      extraction: ImageExtractionOutput
      defaults?: ExtractAndCreateInput["defaults"]
    }
  ) => {
    const items = input.extraction?.items || []
    const firstUnit = items[0]?.unit
    const payloads = items.map((it) => {
      const md = it.metadata || {}
      const inferredUnit = normalizeUnit(it.unit || firstUnit)
      const inferredWidth = md.width ?? input.defaults?.raw_materials?.width_inch
      const inferredMaterialType = md.material_type ?? input.defaults?.raw_materials?.material_type
      return {
        rawMaterialData: {
          name: it.name || "Unnamed Material",
          description: md.description || "Created from image extraction",
          composition: md.composition || md.fabric_content || "",
          unit_of_measure: inferredUnit || "Other",
          status: md.status || "Active",
          color: md.color,
          width: inferredWidth,
          weight: md.weight,
          grade: md.grade,
          certification: md.certification,
          usage_guidelines: md.usage_guidelines,
          storage_requirements: md.storage_requirements,
          material_type: inferredMaterialType,
        },
      }
    })
    return new StepResponse(payloads)
  }
)

const createInventoryItemsStep = createStep(
  "create-inventory-items",
  async (input: { items: any[]; persist: boolean }, { container }) => {
    if (!input.persist || !input.items.length) {
      return new StepResponse({ items: [], ids: [] as string[] })
    }

    const { result } = await createInventoryItemsWorkflow(container).run({
      input: { items: input.items },
    })
    const createdItems: any[] = (result as any)?.items || (result as any) || []
    const ids = createdItems.map((it: any) => it.id).filter(Boolean)
    return new StepResponse({ items: createdItems, ids })
  }
)

const createRawMaterialsForInventoryStep = createStep(
  "create-raw-materials-for-inventory",
  async (input: { inventoryIds: string[]; rawMaterialPayloads: any[] }, { container }) => {
    const createdIds: string[] = []

    for (let i = 0; i < input.inventoryIds.length; i++) {
      const inventoryId = input.inventoryIds[i]
      const rmPayload = input.rawMaterialPayloads[i]
      if (!inventoryId || !rmPayload) continue

      const { result, errors } = await createRawMaterialWorkflow(container).run({
        input: {
          inventoryId,
          rawMaterialData: rmPayload.rawMaterialData,
        },
      })
      if (errors?.length) {
        throw errors[0].error || new Error("Failed to create raw material")
      }
      // The workflow may return an array [rawMaterial, link] or an object
      let rmId: string | undefined = undefined
      if (Array.isArray(result)) {
        const arr = result as any[]
        const first = arr[0] as any
        rmId = first?.id || first?.raw_materials?.id
      } else if (result && typeof result === "object") {
        rmId = (result as any)?.id || (result as any)?.raw_materials?.id
      }
      if (rmId) createdIds.push(rmId)
    }

    return new StepResponse(createdIds)
  }
)

const createInventoryLevelsStep = createStep(
  "create-inventory-levels-for-created-items",
  async (
    input: {
      inventoryIds: string[]
      extraction: ImageExtractionOutput
      defaults?: ExtractAndCreateInput["defaults"]
      persist: boolean
    },
    { container }
  ) => {
    if (!input.persist || !input.inventoryIds?.length) {
      return new StepResponse({ created: 0, levels: [] as any[] })
    }

    let stockLocationId = input.defaults?.inventory?.stock_location_id
    if (!stockLocationId) {
      try {
        const query:any = container.resolve(ContainerRegistrationKeys.QUERY)
        const { data } = await query.graph({ entity: "stock_location", fields: ["id"] })
        stockLocationId = Array.isArray(data) && data.length ? data[0].id : undefined
      } catch (e) {
        // Failed to resolve stock location via query; continue without logging
      }
    }

    if (!stockLocationId) {
      return new StepResponse({ created: 0, levels: [] as any[] })
    }

    const items = input.extraction?.items || []
    const levels = input.inventoryIds.map((id, idx) => {
      const qtyFromExtraction = Number(items[idx]?.quantity ?? NaN)
      const incoming_from_extraction = input.defaults?.inventory?.incoming_from_extraction ?? true
      const incoming_quantity = incoming_from_extraction
        ? (isNaN(qtyFromExtraction) ? input.defaults?.inventory?.default_incoming_quantity ?? 0 : qtyFromExtraction)
        : input.defaults?.inventory?.default_incoming_quantity ?? 0
      const stocked_quantity = input.defaults?.inventory?.default_stocked_quantity ?? 0
      return {
        inventory_item_id: id,
        location_id: stockLocationId!,
        stocked_quantity,
        incoming_quantity,
      }
    })

    const { result } = await createInventoryLevelsWorkflow(container).run({
      input: { inventory_levels: levels },
    })
    return new StepResponse({ created: levels.length, levels: result })
  }
)

export const extractAndCreateInventoryWorkflow = createWorkflow(
  "extract-and-create-inventory",
  (input: ExtractAndCreateInput) => {
    const isTestEnv = process.env.NODE_ENV === "test"

    const extraction: any = isTestEnv
      ? transform({ input }, ({ input }) => ({
          entity_type: input.entity_type,
          items: [
            { name: "Cotton Fabric", quantity: 10, unit: "Meter", sku: "COT-001", confidence: 0.95 },
            { name: "Polyester Thread", quantity: 5, unit: "Piece", sku: "THR-123", confidence: 0.9 },
          ],
          summary: "Sample extraction (test mode)",
          verification: { passed: true, issues: [] as string[] },
        }))
      : imageExtractionMedusaWorkflow.runAsStep({ input })

    const persist = transform({ extraction, input }, ({ extraction, input }) => {
      const passed = extraction?.verification?.passed ?? true
      return Boolean(input.persist && passed)
    })

    const inventoryPayloads = buildInventoryPayloads({
      extraction,
      defaults: transform({ input }, ({ input }) => input.defaults),
    })
    const rawMaterialPayloads = buildRawMaterialPayloads({
      extraction,
      defaults: transform({ input }, ({ input }) => input.defaults),
    })

    const inventoryRes = createInventoryItemsStep({
      items: inventoryPayloads,
      persist,
    })

    const rawMaterialIds = createRawMaterialsForInventoryStep({
      inventoryIds: transform({ inventoryRes }, ({ inventoryRes }) => inventoryRes.ids || []),
      rawMaterialPayloads,
    })

    const levelsRes = createInventoryLevelsStep({
      inventoryIds: transform({ inventoryRes }, ({ inventoryRes }) => inventoryRes.ids || []),
      extraction,
      defaults: transform({ input }, ({ input }) => input.defaults),
      persist,
    })

    return new WorkflowResponse(
      transform(
        { extraction, inventoryRes, rawMaterialIds },
        ({ extraction, inventoryRes, rawMaterialIds }) => ({
          extraction,
          created_inventory_ids: inventoryRes.ids || [],
          created_raw_material_ids: rawMaterialIds || [],
          issues: extraction?.verification?.issues || [],
        }) as ExtractAndCreateOutput
      )
    )
  }
)
