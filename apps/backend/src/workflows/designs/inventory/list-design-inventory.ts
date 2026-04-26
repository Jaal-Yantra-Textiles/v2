import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import DesignInventoryLink from "../../../links/design-inventory-link"

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

interface ListDesignInventoryWorkFlowInput {
  design_id: string
}

export const listDesignInventoryStep = createStep(
  "list-design-inventory",
  async (input: ListDesignInventoryWorkFlowInput, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    // Ensure the design exists before listing inventory links
    const { data: designRows } = await query.graph({
      entity: "design",
      fields: ["id"],
      filters: {
        id: input.design_id,
      },
    })

    if (!designRows || designRows.length === 0) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design with id: ${input.design_id} was not found`
      )
    }

    const { data: linkRows } = await query.graph({
      entity: DesignInventoryLink.entryPoint,
      fields: [
        "*",
        "inventory_item.*",
        "inventory_item.raw_materials.*",
        "inventory_item.location_levels.*",
        "inventory_item.location_levels.stock_locations.*",
      ],
      filters: {
        design_id: input.design_id,
      },
    })

    const inventoryItems = (linkRows || []).map((row: any) => {
      const sanitizedRow = sanitizeBigInt(row)
      return {
        id: sanitizedRow.inventory_item?.id ?? sanitizedRow.inventory_item_id,
        inventory_item_id: sanitizedRow.inventory_item_id,
        planned_quantity: sanitizedRow.planned_quantity,
        consumed_quantity: sanitizedRow.consumed_quantity,
        consumed_at: sanitizedRow.consumed_at,
        location_id: sanitizedRow.location_id,
        metadata: sanitizedRow.metadata || {},
        inventory_item: sanitizedRow.inventory_item,
      }
    })

    return new StepResponse({ inventory_items: inventoryItems })
  }
)

export const listDesignInventoryWorkflow = createWorkflow(
  {
    name: "list-design-inventory",
  },
  (input: ListDesignInventoryWorkFlowInput) => {
    const result = listDesignInventoryStep(input)
    return new WorkflowResponse(result)
  }
)