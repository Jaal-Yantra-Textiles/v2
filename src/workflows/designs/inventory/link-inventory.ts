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
import DesignService from "../../../modules/designs/service"
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
    
    return new WorkflowResponse(linksResult)
  }
)

// De-link workflow types
type DelinkDesignInventoryInput = {
  design_id: string
  inventory_ids: string[]
}

// Validate design status before de-linking
const validateDesignStatus = createStep(
  "validate-design-status",
  async (input: { design_id: string }, { container }) => {
    const designService: DesignService = container.resolve(DESIGN_MODULE)
    
    const design = await designService.retrieveDesign(input.design_id)
    
    if (!design) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design with id ${input.design_id} not found`
      )
    }
    
    // Check if design is in a state that allows de-linking
    const allowedStatuses = [
      "Conceptual",
      "In_Development",
      "Technical_Review",
      "Sample_Production",
      "Revision",
      "On_Hold"
    ]
    
    if (!allowedStatuses.includes(design.status)) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `Cannot de-link inventory from design with status: ${design.status}. Design must not be in Approved, Rejected, or Commerce_Ready state.`
      )
    }
    
    return new StepResponse(design)
  }
)

// De-link inventory items from design
const dismissDesignInventoryLinks = createStep(
  "dismiss-design-inventory-links",
  async (input: { design_id: string; inventory_ids: string[] }, { container }) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    
    // Build links to dismiss
    const links: LinkDefinition[] = input.inventory_ids.map(inventoryId => ({
      [DESIGN_MODULE]: {
        design_id: input.design_id
      },
      [Modules.INVENTORY]: {
        inventory_item_id: inventoryId
      }
    }))
    
    await remoteLink.dismiss(links)
    
    return new StepResponse(links, { links, design_id: input.design_id, inventory_ids: input.inventory_ids })
  },
  async (rollbackData, { container }) => {
    // Rollback: re-create the links if de-linking fails
    if (!rollbackData) return
    
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = rollbackData.inventory_ids.map(inventoryId => ({
      [DESIGN_MODULE]: {
        design_id: rollbackData.design_id
      },
      [Modules.INVENTORY]: {
        inventory_item_id: inventoryId
      },
      data: {
        design_id: rollbackData.design_id,
        inventory_id: inventoryId
      }
    }))
    
    await remoteLink.create(links)
  }
)

export const delinkDesignInventoryWorkflow = createWorkflow(
  {
    name: "delink-design-inventory",
    store: true
  },
  (input: DelinkDesignInventoryInput) => {
    // First validate design status
    validateDesignStatus({ 
      design_id: input.design_id 
    })

    // Then dismiss the links
    const result = dismissDesignInventoryLinks({
      design_id: input.design_id,
      inventory_ids: input.inventory_ids
    })
    
    return new WorkflowResponse(result)
  }
)
