import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"

import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import type ProductionRunService from "../../modules/production_runs/service"
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

export type RecreateDesignEntry = {
  design_id: string
  quantity: number
  notes?: string
}

export type RecreateProductionRunInput = {
  designs: RecreateDesignEntry[]
  partner_id: string
  run_type?: "production" | "sample"
  notes?: string
  metadata?: Record<string, any>
}

/**
 * Fetches and snapshots all designs in the bundle, including specs, colors,
 * sizes, and linked inventory items.
 */
const fetchBundleSnapshotsStep = createStep(
  "fetch-bundle-snapshots",
  async (input: { designs: RecreateDesignEntry[] }, { container }) => {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

    const snapshots: Array<{
      entry: RecreateDesignEntry
      design: any
      inventory_links: any[]
    }> = []

    for (const entry of input.designs) {
      const { data: designs } = await query.graph({
        entity: "designs",
        fields: ["*", "specifications.*", "colors.*", "size_sets.*"],
        filters: { id: entry.design_id },
      })

      if (!designs?.length) {
        throw new MedusaError(
          MedusaError.Types.NOT_FOUND,
          `Design ${entry.design_id} not found`
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
        filters: { design_id: entry.design_id },
      })

      const inventoryLinks = (linkRows || []).map((row: any) => {
        const s = sanitizeBigInt(row)
        return {
          inventory_item_id: s.inventory_item_id,
          planned_quantity: s.planned_quantity,
          consumed_quantity: s.consumed_quantity,
          consumed_at: s.consumed_at,
          location_id: s.location_id,
          metadata: s.metadata || {},
          inventory_item: s.inventory_item,
        }
      })

      snapshots.push({
        entry,
        design: designs[0],
        inventory_links: inventoryLinks,
      })
    }

    return new StepResponse(snapshots)
  }
)

/**
 * Creates the parent production run with a combined snapshot of all designs,
 * then creates one child run per design.
 */
const createBundledRunsStep = createStep(
  "create-bundled-runs",
  async (
    input: {
      partner_id: string
      run_type: "production" | "sample"
      notes?: string
      metadata?: Record<string, any>
      captured_at: string
      parent_snapshot: Record<string, any>
      child_payloads: Array<{
        design_id: string
        quantity: number
        snapshot: Record<string, any>
        notes?: string
      }>
    },
    { container }
  ) => {
    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    const totalQuantity = input.child_payloads.reduce(
      (sum, c) => sum + c.quantity,
      0
    )

    // Create parent run — uses the first design_id as anchor but snapshot has all
    const parentCreated = await productionRunService.createProductionRuns({
      design_id: input.child_payloads[0].design_id,
      partner_id: input.partner_id,
      quantity: totalQuantity,
      run_type: input.run_type,
      snapshot: input.parent_snapshot,
      captured_at: new Date(input.captured_at),
      metadata: {
        ...input.metadata,
        source: "admin.designs.recreate",
        is_recreation_bundle: true,
        notes: input.notes,
      },
    })

    const parent = Array.isArray(parentCreated) ? parentCreated[0] : parentCreated
    const parentId = (parent as any).id

    // Create child runs — one per design
    const children: any[] = []
    for (const child of input.child_payloads) {
      const childCreated = await productionRunService.createProductionRuns({
        design_id: child.design_id,
        partner_id: input.partner_id,
        parent_run_id: parentId,
        quantity: child.quantity,
        run_type: input.run_type,
        snapshot: child.snapshot,
        captured_at: new Date(input.captured_at),
        metadata: {
          source: "admin.designs.recreate",
          notes: child.notes,
        },
      })

      const childRun = Array.isArray(childCreated)
        ? childCreated[0]
        : childCreated
      children.push(childRun)
    }

    return new StepResponse(
      { parent, children },
      { parentId, childIds: children.map((c: any) => c.id) }
    )
  },
  async (
    rollbackData: { parentId: string; childIds: string[] } | undefined,
    { container }
  ) => {
    if (!rollbackData) return

    const productionRunService: ProductionRunService = container.resolve(
      PRODUCTION_RUNS_MODULE
    )

    for (const childId of rollbackData.childIds) {
      await productionRunService.softDeleteProductionRuns(childId)
    }
    await productionRunService.softDeleteProductionRuns(rollbackData.parentId)
  }
)

export const recreateProductionRunWorkflow = createWorkflow(
  "recreate-production-run",
  (input: RecreateProductionRunInput) => {
    const snapshots = fetchBundleSnapshotsStep({ designs: input.designs })

    const captured_at = transform({}, () => new Date().toISOString())

    const buildResult = transform(
      { input, snapshots, captured_at },
      (data) => {
        const designSnapshots = data.snapshots.map((s: any) => ({
          design: {
            id: s.design.id,
            name: s.design.name,
            description: s.design.description,
            status: s.design.status,
            priority: s.design.priority,
            metadata: s.design.metadata || {},
            moodboard: s.design.moodboard ?? null,
          },
          specifications: s.design.specifications || [],
          colors: s.design.colors || [],
          size_sets: s.design.size_sets || [],
          inventory_links: s.inventory_links || [],
          quantity: s.entry.quantity,
          notes: s.entry.notes,
        }))

        const parentSnapshot = {
          captured_at: data.captured_at,
          is_bundle: true,
          designs: designSnapshots,
          provenance: {
            partner_id: data.input.partner_id,
            total_quantity: designSnapshots.reduce(
              (sum: number, d: any) => sum + d.quantity,
              0
            ),
            notes: data.input.notes,
          },
        }

        const childPayloads = designSnapshots.map((ds: any) => ({
          design_id: ds.design.id,
          quantity: ds.quantity,
          notes: ds.notes,
          snapshot: {
            captured_at: data.captured_at,
            design: ds.design,
            specifications: ds.specifications,
            colors: ds.colors,
            size_sets: ds.size_sets,
            inventory_links: ds.inventory_links,
            provenance: {
              partner_id: data.input.partner_id,
              quantity: ds.quantity,
            },
          },
        }))

        return { parentSnapshot, childPayloads }
      }
    )

    const runs = createBundledRunsStep({
      partner_id: input.partner_id,
      run_type: input.run_type ?? ("production" as any),
      notes: input.notes,
      metadata: input.metadata,
      captured_at,
      parent_snapshot: buildResult.parentSnapshot,
      child_payloads: buildResult.childPayloads,
    })

    return new WorkflowResponse(runs)
  }
)
