import { container } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow
} from "@medusajs/framework/workflows-sdk"
import { RAW_MATERIAL_MODULE } from "../../modules/raw_material"
import { LinkDefinition } from "@medusajs/framework/types"
import RawMaterialService from "../../modules/raw_material/service"

type CreateRawMaterialInput = {
  inventoryId: string
  rawMaterialData: {
    name: string
    description: string
    composition: string
    specifications?: Record<string, any>
    unit_of_measure?: string
    minimum_order_quantity?: number
    lead_time_days?: number
    color?: string
    width?: string
    weight?: string
    grade?: string
    certification?: Record<string, any>
    usage_guidelines?: string
    storage_requirements?: string
    status?: string
    metadata?: Record<string, any>
    material_type?: {
      name: string
      description?: string
      category?: "Fiber" | "Yarn" | "Fabric" | "Trim" | "Dye" | "Chemical" | "Accessory" | "Other"
      properties?: Record<string, any>
      metadata?: Record<string, any>
    }
  }
}

const createRawMaterialData = createStep(
  "create-raw-material-data",
  async (input: { rawMaterialData: any }) => {
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE)
    const rawMaterial = await rawMaterialService.createRawMaterials({
      ...input.rawMaterialData
    })
    return new StepResponse(rawMaterial, rawMaterial.id)
  },
  async (rawMaterial, { container }) => {
    if (!rawMaterial){
      return 
    }
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE)
    await rawMaterialService.deleteRawMaterials(rawMaterial)
  }
)

const createRawMaterialLink = createStep(
  "create-raw-material-link",
  async (input: { inventoryId: string, rawMaterialId: string }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = []

    links.push({
      [Modules.INVENTORY]: {
        inventory_item_id: input.inventoryId
      },
      [RAW_MATERIAL_MODULE]: {
        raw_materials_id: input.rawMaterialId
      },
      data: {
        raw_materials_id: input.rawMaterialId,
        inventory_id: input.inventoryId
      }
    })
    await remoteLink.create(links)
    return new StepResponse(links)
  },
  async (links: LinkDefinition[], { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)

export const createRawMaterialWorkflow = createWorkflow(
  "create-raw-material",
  (input: CreateRawMaterialInput) => {
    const rawMaterialResult = createRawMaterialData({ 
      rawMaterialData: input.rawMaterialData 
    })

    const rawMaterialLinkResult = createRawMaterialLink({
      inventoryId: input.inventoryId,
      rawMaterialId: rawMaterialResult.id
    })
    
    return new WorkflowResponse([
      rawMaterialResult,
      rawMaterialLinkResult
    ])
  }
)