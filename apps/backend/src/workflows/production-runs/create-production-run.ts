import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
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
import { dualWriteUnifiedRunOrderStep } from "./dual-write-unified-run-order"

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
  // #1112 — optional so a retail-fulfillment run can be minted from a product
  // with NO backing design (product-only path). When absent, product_id is
  // required and the snapshot is built from the product instead of a design.
  design_id?: string | null
  partner_id?: string | null
  quantity?: number
  // #1112 — for runs born already-`completed` (retail fulfillment), stamp the
  // produced yield up front instead of leaving it for the lifecycle to fill.
  produced_quantity?: number
  run_type?: "production" | "sample"
  product_id?: string
  variant_id?: string
  order_id?: string
  order_line_item_id?: string
  metadata?: Record<string, any>
  task_ids?: string[]
  // Roadmap #6 Phase 4 — partner self-serve runs.
  status?:
    | "draft"
    | "pending_review"
    | "approved"
    | "sent_to_partner"
    | "in_progress"
    | "completed"
    | "cancelled"
  execution_mode?: "in_house" | "outsourced"
  sub_partner_id?: string | null
  // #826 S3a — suppress the per-run unified-order projection. Design-order runs
  // are collated into ONE work-order by the batch projection
  // (projectDesignOrderToUnifiedOrder), so they must NOT each mint their own.
  skip_unified_projection?: boolean
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

// #1112 — product-only provenance path. When a retail line item resolves to a
// product with no backing design, snapshot the product spine instead of a
// design so a run can still be minted (design_id stays null).
const fetchProductSnapshotStep = createStep(
  "fetch-product-snapshot",
  async (input: { product_id?: string }, { container }) => {
    if (!input.product_id) {
      return new StepResponse(null)
    }

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "handle",
        "status",
        "thumbnail",
        "subtitle",
        "metadata",
      ],
      filters: { id: input.product_id },
    })

    const products = data || []
    if (!products.length) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Product ${input.product_id} not found`
      )
    }

    return new StepResponse(products[0])
  }
)

// #1112 — hang the run off the Product spine so the provenance trail is
// queryable via `product.production_runs`. Idempotent-safe: only fires when a
// product_id is present.
const linkProductionRunToProductStep = createStep(
  "link-production-run-to-product",
  async (
    input: { production_run_id: string; product_id?: string },
    { container }
  ) => {
    if (!input.product_id) {
      return new StepResponse<LinkDefinition | null, LinkDefinition | null>(
        null,
        null
      )
    }

    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    const link: LinkDefinition = {
      [Modules.PRODUCT]: { product_id: input.product_id },
      [PRODUCTION_RUNS_MODULE]: {
        production_runs_id: input.production_run_id,
      },
    }

    await remoteLink.create([link])
    return new StepResponse<LinkDefinition | null, LinkDefinition | null>(
      link,
      link
    )
  },
  async (link: LinkDefinition | null, { container }) => {
    if (!link) {
      return
    }
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as Link
    await remoteLink.dismiss([link])
  }
)

const createProductionRunStep = createStep(
  "create-production-run",
  async (
    input: {
      payload: CreateProductionRunInput
      design?: any
      inventory?: { inventory_links: any[] } | null
      captured_at: Date
      snapshot: Record<string, any>
    },
    { container }
  ) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const created = await productionRunService.createProductionRuns({
      design_id: input.payload.design_id ?? null,
      partner_id: input.payload.partner_id ?? null,
      quantity: input.payload.quantity ?? 1,
      run_type: input.payload.run_type ?? "production",
      product_id: input.payload.product_id,
      variant_id: input.payload.variant_id,
      order_id: input.payload.order_id,
      order_line_item_id: input.payload.order_line_item_id,
      snapshot: input.snapshot,
      captured_at: input.captured_at,
      metadata: input.payload.metadata,
      // Phase 4: only set when explicitly provided so admin/order
      // paths keep the model defaults (status=pending_review,
      // execution_mode=in_house).
      ...(input.payload.status ? { status: input.payload.status } : {}),
      ...(input.payload.produced_quantity !== undefined
        ? { produced_quantity: input.payload.produced_quantity }
        : {}),
      ...(input.payload.execution_mode
        ? { execution_mode: input.payload.execution_mode }
        : {}),
      ...(input.payload.sub_partner_id !== undefined
        ? { sub_partner_id: input.payload.sub_partner_id }
        : {}),
    } as any)

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
    // #1112 — branch on design presence. Design work-orders snapshot the design
    // (+ its inventory links); a retail product-only run snapshots the product
    // spine instead. Both feed the same provenance block.
    const design = when({ input }, (data) => Boolean(data.input.design_id)).then(
      () => fetchDesignSnapshotStep({ design_id: input.design_id })
    )
    const inventory = when({ input }, (data) =>
      Boolean(data.input.design_id)
    ).then(() => fetchDesignInventorySnapshotStep({ design_id: input.design_id }))
    const product = when({ input }, (data) => !data.input.design_id).then(() =>
      fetchProductSnapshotStep({ product_id: input.product_id })
    )

    const captured_at = transform({}, () => new Date())

    const snapshot = transform(
      { input, design, inventory, product, captured_at },
      (data) => {
        const capturedAtDate =
          data.captured_at instanceof Date
            ? data.captured_at
            : new Date(data.captured_at as any)

        const designData: any = data.design || null
        const productData: any = data.product || null

        return {
          captured_at: capturedAtDate.toISOString(),
          design: designData
            ? {
                id: designData.id,
                name: designData.name,
                description: designData.description,
                status: designData.status,
                priority: designData.priority,
                metadata: designData.metadata || {},
                moodboard: designData.moodboard ?? null,
              }
            : null,
          // #1112 — product spine snapshot for the design-less provenance path.
          product: productData
            ? {
                id: productData.id,
                title: productData.title,
                handle: productData.handle,
                status: productData.status,
                thumbnail: productData.thumbnail ?? null,
                subtitle: productData.subtitle ?? null,
                metadata: productData.metadata || {},
              }
            : null,
          specifications: designData?.specifications || [],
          colors: designData?.colors || [],
          size_sets: designData?.size_sets || [],
          inventory_links: data.inventory?.inventory_links || [],
          provenance: {
            order_id: data.input.order_id,
            order_line_item_id: data.input.order_line_item_id,
            product_id: data.input.product_id,
            variant_id: data.input.variant_id,
            quantity: data.input.quantity ?? 1,
            partner_id: data.input.partner_id ?? null,
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

    // #1112 — link the run to the Product spine (provenance queryable via
    // product.production_runs). Fires whenever a product_id is present, for
    // both the design and product-only paths.
    when({ input }, (data) => Boolean(data.input.product_id)).then(() => {
      linkProductionRunToProductStep({
        production_run_id: productionRunId,
        product_id: input.product_id,
      })
    })

    when({ input }, (data) => Boolean(data.input.task_ids?.length)).then(() => {
      linkProductionRunToTasksStep({
        production_run_id: productionRunId,
        task_ids: input.task_ids || [],
      })
    })

    // #342 — best-effort projection onto a kind=design core order. Skipped for
    // design-order runs (#826 S3a): they're collated into one work-order by the
    // batch projection instead of each minting their own.
    when({ input }, (data) => !data.input.skip_unified_projection).then(() => {
      dualWriteUnifiedRunOrderStep({ production_run_id: productionRunId })
    })

    return new WorkflowResponse(run)
  }
)
