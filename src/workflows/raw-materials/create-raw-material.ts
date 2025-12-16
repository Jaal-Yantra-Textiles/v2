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
import type { Link } from "@medusajs/modules-sdk"

type CreateRawMaterialInput = {
  inventoryId: string
  rawMaterialData: {
    name: string
    description?: string
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
    material_type?: string | object  // Can be string (name) or object
    material_type_id?: string        // Or existing ID
    media?: Record<string, any>
  }
}

export const checkMaterialType = createStep(
  "check-material-type",
  async (input: { rawMaterialData: any }, { container }) => {
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE);
    let materialType;
    let rawMaterialData = { ...input.rawMaterialData };
    
    // Check for existing material type using ID
    if (rawMaterialData.material_type_id) {
      try {
        materialType = await rawMaterialService.retrieveMaterialType(rawMaterialData.material_type_id);
      } catch (error) {
        // Material type not found by ID
        throw new Error(`Material type with ID ${rawMaterialData.material_type_id} not found`);
      }
    } 
    // Handle string-based material type (create new)
    else if (typeof rawMaterialData.material_type === 'string') {
      try {
        // Try to find existing material type with the same name
        const types = await rawMaterialService.listMaterialTypes({
          name: rawMaterialData.material_type
        });
        
        if (types && types.length > 0) {
          materialType = types[0];
          // Set the material_type_id to the found category's ID
          rawMaterialData.material_type_id = materialType.id;
        } else {
          // Create new material type
          materialType = await rawMaterialService.createMaterialTypes({
            name: rawMaterialData.material_type as string,
            category: "Other" // Default category if not specified
          });
          rawMaterialData.material_type_id = materialType.id;
        }
      } catch (error) {
        // Error handling for material type creation/lookup
        console.error("Error processing material type:", error);
        throw error;
      }
    }
    
    // Clean up the data structure
    if (rawMaterialData.material_type_id) {
      // Remove the material_type field as we're using material_type_id
      delete rawMaterialData.material_type;
    }
    
    return new StepResponse({ rawMaterialData });
  }
);

const createRawMaterialData = createStep(
  "create-raw-material-data",
  async (input: { rawMaterialData: any }, { container }) => {
    const rawMaterialService: RawMaterialService = container.resolve(RAW_MATERIAL_MODULE)
    const { media, ...rest } = input.rawMaterialData
    const rawMaterial = await rawMaterialService.createRawMaterials({
      ...rest,
      media,
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
  async (input: { inventoryId: string, rawMaterialId: string }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
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
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(links)
  }
)

export const createRawMaterialWorkflow = createWorkflow(
  "create-raw-material",
  (input: CreateRawMaterialInput) => {
    // First process the material type
    const processedInput = checkMaterialType({
      rawMaterialData: input.rawMaterialData
    });
    
    // Then create the raw material with processed input
    const rawMaterialResult = createRawMaterialData(processedInput)

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