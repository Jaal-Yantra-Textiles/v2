/**
 * Here we are going to link the existing inventory with the designs, 
 * the workflow will look for the existing inventory with is_raw_maeterial 
 * if thats true then we may link the inventory to the design
 */


import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  createStep,
  WorkflowResponse,
  StepResponse,
  createWorkflow
} from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../../modules/designs"
import { MedusaError } from "@medusajs/utils"
import { LinkDefinition } from "@medusajs/framework/types"

type LinkDesignInventoryInput = {
  design_id: string
  inventory_ids: string[]
}

const validateInventoryItems = createStep(
  "validate-inventory-items",
  async (input: { inventory_ids: string[] }, { container }) => {
    const inventoryService = container.resolve(`${Modules.INVENTORY}`)
    
    // Validate all inventory items exist
    const inventoryItems = await Promise.all(
      input.inventory_ids.map(async (id) => {
        const item = await inventoryService.retrieveInventoryItem(id)
        if (!item) {
          throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Inventory item with id ${id} not found`
          )
        }
        return item
      })
    )
    
    return new StepResponse(inventoryItems)
  }
)

const createDesignInventoryLinks = createStep(
  "create-design-inventory-links",
  async (input: { design_id: string; inventory_ids: string[] }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = []
   input.inventory_ids.map(inventoryId => (
    links.push({
      [DESIGN_MODULE]: {
        design_id: input.design_id
      },
      [Modules.INVENTORY]: {
        inventory_item_id: inventoryId
      },
      data: {
        design_id: input.design_id,
        inventory_id: inventoryId
      }
    })))
    await remoteLink.create(links)
    return new StepResponse(links)
  },
  async (links: LinkDefinition[], { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)

const adjustInventoryStep = createStep(
  "adjust-inventory",
  async (input: { design_id: string; inventory_ids: string[] }, { container }) => {
    const inventoryService = container.resolve(Modules.INVENTORY)
    
    // Get all inventory levels with their location IDs for the input inventory items
    const inventoryLevelsPromises = input.inventory_ids.map(async (inventoryId) => {
      const levels = await inventoryService.listInventoryLevels({
        inventory_item_id: inventoryId
      })
      return { inventoryId, levels }
    })
    
    const inventoryLevelsResults = await Promise.all(inventoryLevelsPromises)
    
    // Process each inventory item and its locations recursively
    for (const { inventoryId, levels } of inventoryLevelsResults) {
      // If there are location levels, adjust inventory for each location
      if (levels.length > 0) {
        const adjustments = levels.map(level => ({
          inventoryItemId: inventoryId,
          locationId: level.location_id,
          adjustment: -1
        }))
        
        await inventoryService.adjustInventory(adjustments)
      }
    }
    
    return new StepResponse(inventoryLevelsResults)
  }
)


export const linkDesignInventoryWorkflow = createWorkflow(
  {
    name: "link-design-inventory",
    store: true
  },
  (input: LinkDesignInventoryInput) => {
    // First validate that all inventory items exist
     validateInventoryItems({ 
      inventory_ids: input.inventory_ids 
    })

    // Then create the links
    const linksResult =  createDesignInventoryLinks({
      design_id: input.design_id,
      inventory_ids: input.inventory_ids
    })

    // once the links are set adjust the inventory
    const adjustmentResult = adjustInventoryStep({
      design_id: input.design_id,
      inventory_ids: input.inventory_ids
    })
    
    return new WorkflowResponse([linksResult, adjustmentResult])
  }
)
