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
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { DESIGN_MODULE } from "../../../modules/designs"
import DesignService from "../../../modules/designs/service"
import { MedusaError } from "@medusajs/utils"
import { IInventoryService, LinkDefinition } from "@medusajs/framework/types"
import DesignInventoryLink from "../../../links/design-inventory-link"

type InventoryLinkPayload = {
  inventory_id: string
  planned_quantity?: number
  location_id?: string
  metadata?: Record<string, any>
}

type LinkDesignInventoryInput = {
  design_id: string
  inventory_ids?: string[]
  inventory_items?: InventoryLinkPayload[]
}

type UpdateDesignInventoryLinkInput = {
  design_id: string
  inventory_id: string
  planned_quantity?: number | null
  location_id?: string | null
  metadata?: Record<string, any> | null
}

const sanitizeBigInt = (value: any): any => {
  if (typeof value === "bigint") {
    return Number(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeBigInt(item))
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce<Record<string, any>>((acc, [key, val]) => {
      acc[key] = sanitizeBigInt(val)
      return acc
    }, {})
  }

  return value
}

const buildInventoryPayloads = (input: LinkDesignInventoryInput): InventoryLinkPayload[] => {
  const payloadMap = new Map<string, InventoryLinkPayload>()

  for (const item of input.inventory_items || []) {
    if (!item?.inventory_id) {
      continue
    }
    payloadMap.set(item.inventory_id, {
      inventory_id: item.inventory_id,
      planned_quantity: item.planned_quantity,
      location_id: item.location_id,
      metadata: item.metadata,
    })
  }

  for (const id of input.inventory_ids || []) {
    if (!payloadMap.has(id)) {
      payloadMap.set(id, { inventory_id: id })
    }
  }

  return Array.from(payloadMap.values())
}

const prepareInventoryLinkPayloads = createStep(
  "prepare-design-inventory-payloads",
  async (input: LinkDesignInventoryInput) => {
    const payloads = buildInventoryPayloads(input)

    if (!payloads.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "At least one inventory link payload must be provided."
      )
    }

    return new StepResponse(payloads)
  }
)

const validateInventoryItems = createStep(
  "validate-inventory-items",
  async (input: { inventory_ids: string[] }, { container }) => {
    const inventoryService:IInventoryService = container.resolve(`${Modules.INVENTORY}`)
    
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
  async (
    input: { design_id: string; payloads: InventoryLinkPayload[] },
    { container, context }
  ) => {
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK)
    const links: LinkDefinition[] = []
    const transactionId = context.transactionId

    input.payloads.forEach((payload) => {
      const data: Record<string, any> = {}
      if (typeof payload.planned_quantity === "number") {
        data.planned_quantity = payload.planned_quantity
      }
      if (payload.location_id) {
        data.location_id = payload.location_id
      }
      if (payload.metadata) {
        data.metadata = payload.metadata
      }

      if (transactionId) {
        data.metadata = {
          ...(data.metadata || {}),
          transaction_id: transactionId
        }
      }

      if (!data.metadata && !payload.metadata) {
        data.metadata = {
          source: "link-design-inventory"
        }
      } else if (data.metadata && !data.metadata.source) {
        data.metadata.source = "link-design-inventory"
      }

      links.push({
        [DESIGN_MODULE]: {
          design_id: input.design_id
        },
        [Modules.INVENTORY]: {
          inventory_item_id: payload.inventory_id
        },
        data,
      })
    })

    if (!links.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "No inventory payloads provided for linking."
      )
    }

    await remoteLink.create(links)
    return new StepResponse(links)
  },
  async (links: LinkDefinition[], { container }) => {
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK)
    await remoteLink.dismiss(links)
  }
)



export const linkDesignInventoryWorkflow = createWorkflow(
  {
    name: "link-design-inventory",
    store: true
  },
  (input: LinkDesignInventoryInput) => {
    const payloads = prepareInventoryLinkPayloads(input)

    const inventoryIds = transform({ payloads }, ({ payloads }) =>
      payloads.map((payload) => payload.inventory_id)
    ) as unknown as string[]

    validateInventoryItems({
      inventory_ids: inventoryIds
    })

    const linksResult = createDesignInventoryLinks({
      design_id: input.design_id,
      payloads,
    })

    return new WorkflowResponse(linksResult)
  }
)

const getDesignInventoryLinkStep = createStep(
  "get-design-inventory-link",
  async (input: { design_id: string; inventory_id: string }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: DesignInventoryLink.entryPoint,
      fields: [
        "design_id",
        "inventory_item_id",
        "planned_quantity",
        "consumed_quantity",
        "consumed_at",
        "location_id",
        "metadata",
      ],
      filters: {
        design_id: input.design_id,
        inventory_item_id: input.inventory_id,
      },
      pagination: {
        take: 1,
      },
    })

    if (!data?.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Inventory link not found for design ${input.design_id} and inventory ${input.inventory_id}`
      )
    }

    return new StepResponse(sanitizeBigInt(data[0]))
  }
)

const updateDesignInventoryLinkStep = createStep(
  "update-design-inventory-link",
  async (
    input: {
      design_id: string
      inventory_id: string
      updates: UpdateDesignInventoryLinkInput
      existing: any
    },
    { container }
  ) => {
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    const linkDefinition: LinkDefinition = {
      [DESIGN_MODULE]: { design_id: input.design_id },
      [Modules.INVENTORY]: { inventory_item_id: input.inventory_id },
    }

    const mergedData = {
      planned_quantity:
        input.updates.planned_quantity !== undefined
          ? input.updates.planned_quantity
          : input.existing.planned_quantity ?? null,
      consumed_quantity: input.existing.consumed_quantity ?? null,
      consumed_at: input.existing.consumed_at ?? null,
      location_id:
        input.updates.location_id !== undefined ? input.updates.location_id : input.existing.location_id ?? null,
      metadata:
        input.updates.metadata !== undefined ? input.updates.metadata : input.existing.metadata ?? null,
    }

    await remoteLink.dismiss([linkDefinition])
    await remoteLink.create([
      {
        ...linkDefinition,
        data: mergedData,
      },
    ])

    return new StepResponse(
      mergedData,
      {
        design_id: input.design_id,
        inventory_id: input.inventory_id,
        previousData: {
          planned_quantity: input.existing.planned_quantity ?? null,
          consumed_quantity: input.existing.consumed_quantity ?? null,
          consumed_at: input.existing.consumed_at ?? null,
          location_id: input.existing.location_id ?? null,
          metadata: input.existing.metadata ?? null,
        },
      }
    )
  },
  async (data, { container }) => {
    if (!data) {
      return
    }

    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)
    const linkDefinition: LinkDefinition = {
      [DESIGN_MODULE]: { design_id: data.design_id },
      [Modules.INVENTORY]: { inventory_item_id: data.inventory_id },
    }

    await remoteLink.dismiss([linkDefinition])
    await remoteLink.create([
      {
        ...linkDefinition,
        data: data.previousData,
      },
    ])
  }
)

export const updateDesignInventoryLinkWorkflow = createWorkflow(
  {
    name: "update-design-inventory-link",
    store: true,
  },
  (input: UpdateDesignInventoryLinkInput) => {
    const existing = getDesignInventoryLinkStep({
      design_id: input.design_id,
      inventory_id: input.inventory_id,
    })

    const updated = updateDesignInventoryLinkStep({
      design_id: input.design_id,
      inventory_id: input.inventory_id,
      updates: input,
      existing,
    })

    return new WorkflowResponse(updated)
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
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK)
    
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
    
    const remoteLink:any = container.resolve(ContainerRegistrationKeys.LINK)
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
