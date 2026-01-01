import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk"
import type { Link } from "@medusajs/modules-sdk"
import type { LinkDefinition } from "@medusajs/framework/types"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"

import { TASKS_MODULE } from "../../modules/tasks"
import DesignInventoryLink from "../../links/design-inventory-link"

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

export type CreateProductionRunInput = {
  design_id: string
  partner_id: string
  quantity?: number
  product_id?: string
  variant_id?: string
  order_id?: string
  order_line_item_id?: string
  metadata?: Record<string, any>
  task_ids?: string[]
}

const fetchDesignSnapshotStep = createStep(
  "fetch-design-snapshot",
  async (input: Pick<CreateProductionRunInput, "design_id">, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "designs",
      fields: [
        "*",
        "specifications.*",
        "colors.*",
        "size_sets.*",
      ],
      filters: {
        id: input.design_id,
      },
    })

    const designs = data || []
    if (!designs.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Design ${input.design_id} not found`
      )
    }

    return new StepResponse(designs[0])
  }
)

const fetchDesignInventorySnapshotStep = createStep(
  "fetch-design-inventory-snapshot",
  async (input: Pick<CreateProductionRunInput, "design_id">, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

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

    const inventoryLinks = (linkRows || []).map((row: any) => {
      const sanitizedRow = sanitizeBigInt(row)
      return {
        inventory_item_id: sanitizedRow.inventory_item_id,
        planned_quantity: sanitizedRow.planned_quantity,
        consumed_quantity: sanitizedRow.consumed_quantity,
        consumed_at: sanitizedRow.consumed_at,
        location_id: sanitizedRow.location_id,
        metadata: sanitizedRow.metadata || {},
        inventory_item: sanitizedRow.inventory_item,
      }
    })

    return new StepResponse({ inventory_links: inventoryLinks })
  }
)

const createProductionRunStep = createStep(
  "create-production-run",
  async (
    input: {
      payload: CreateProductionRunInput
      design: any
      inventory: { inventory_links: any[] }
      captured_at: Date
      snapshot: Record<string, any>
    },
    { container }
  ) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const created = await productionRunService.createProductionRuns({
      design_id: input.payload.design_id,
      partner_id: input.payload.partner_id,
      quantity: input.payload.quantity ?? 1,
      product_id: input.payload.product_id,
      variant_id: input.payload.variant_id,
      order_id: input.payload.order_id,
      order_line_item_id: input.payload.order_line_item_id,
      snapshot: input.snapshot,
      captured_at: input.captured_at,
      metadata: input.payload.metadata,
    })

    const run = Array.isArray(created) ? created[0] : created
    return new StepResponse(run, (run as any).id)
  },
  async (created: any, { container }) => {
    if (!created?.id) {
      return
    }

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    await productionRunService.softDeleteProductionRuns(created.id)
  }
)

const linkProductionRunToTasksStep = createStep(
  "link-production-run-to-tasks",
  async (
    input: { production_run_id: string; task_ids: string[] },
    { container }
  ) => {
    if (!input.task_ids?.length) {
      return new StepResponse([])
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link

    const links: LinkDefinition[] = input.task_ids.map((taskId) => ({
      [PRODUCTION_RUNS_MODULE]: {
        production_runs_id: input.production_run_id,
      },
      [TASKS_MODULE]: {
        task_id: taskId,
      },
    }))

    const created = await remoteLink.create(links)
    return new StepResponse(created, links)
  },
  async (links: LinkDefinition[] | undefined, { container }) => {
    if (!links?.length) {
      return
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss(links)
  }
)

export const createProductionRunWorkflow = createWorkflow(
  "create-production-run",
  (input: CreateProductionRunInput) => {
    const design = fetchDesignSnapshotStep({ design_id: input.design_id })
    const inventory = fetchDesignInventorySnapshotStep({ design_id: input.design_id })

    const captured_at = transform({}, () => new Date())

    const snapshot = transform(
      { input, design, inventory, captured_at },
      (data) => {
        return {
          captured_at: data.captured_at.toISOString(),
          design: {
            id: data.design.id,
            name: data.design.name,
            description: data.design.description,
            status: data.design.status,
            priority: data.design.priority,
            metadata: data.design.metadata || {},
            moodboard: data.design.moodboard ?? null,
          },
          specifications: data.design.specifications || [],
          colors: data.design.colors || [],
          size_sets: data.design.size_sets || [],
          inventory_links: data.inventory.inventory_links || [],
          provenance: {
            order_id: data.input.order_id,
            order_line_item_id: data.input.order_line_item_id,
            product_id: data.input.product_id,
            variant_id: data.input.variant_id,
            quantity: data.input.quantity ?? 1,
            partner_id: data.input.partner_id,
          },
        }
      }
    )

    const run = createProductionRunStep({
      payload: input,
      design,
      inventory,
      captured_at,
      snapshot,
    })

    const productionRunId = transform({ run }, (data) => (data.run as any).id as string)

    when({ input }, (data) => Boolean(data.input.task_ids?.length)).then(() => {
      linkProductionRunToTasksStep({
        production_run_id: productionRunId,
        task_ids: input.task_ids || [],
      })
    })

    return new WorkflowResponse(run)
  }
)
