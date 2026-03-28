import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"

const DEFAULT_PRODUCTION_OVERHEAD_PERCENT = 30

/**
 * When a sample production run completes, auto-calculate the design's
 * cost from committed consumption logs.
 *
 * Writes to design.estimated_cost, design.material_cost, design.production_cost,
 * and design.cost_breakdown (structured JSON on a proper column).
 */
export default async function sampleRunCompletedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const runId = event.data?.id
  if (!runId) return

  const productionRunService = container.resolve("production_runs") as any

  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(runId)
  } catch {
    return
  }

  if (run.run_type !== "sample") return
  if (run.status !== "completed") return
  if (!run.design_id) return

  const designId = run.design_id
  const consumptionLogService = container.resolve("consumption_log") as any
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const designService = container.resolve("design") as any

  const [logs] = await consumptionLogService.listAndCountConsumptionLogs(
    { design_id: designId, is_committed: true },
    { take: 500 }
  )

  if (!logs.length) {
    console.log(`[sample-run-completed] Design ${designId}: no committed logs — skipping`)
    return
  }

  let materialCost = 0
  const items: any[] = []

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  for (const log of logs) {
    let unitCost = Number(log.unit_cost) || 0
    let costSource = "partner_input"
    let title = log.inventory_item_id

    // Resolve title from inventory item
    try {
      const item = await inventoryService.retrieveInventoryItem(log.inventory_item_id)
      title = item.title || item.sku || log.inventory_item_id
    } catch {}

    // If no partner-input cost, try raw_material.unit_cost
    if (!unitCost) {
      try {
        const { data: rmLinks } = await query.graph({
          entity: "inventory_item_raw_materials",
          filters: { inventory_item_id: log.inventory_item_id },
          fields: ["raw_materials.unit_cost"],
        })
        const rmCost = Number(rmLinks?.[0]?.raw_materials?.unit_cost) || 0
        if (rmCost > 0) {
          unitCost = rmCost
          costSource = "raw_material"
        } else {
          costSource = "none"
        }
      } catch {
        costSource = "none"
      }
    }

    const lineTotal = Number(log.quantity) * unitCost
    materialCost += lineTotal
    items.push({
      inventory_item_id: log.inventory_item_id,
      title,
      quantity: Number(log.quantity),
      unit_cost: unitCost,
      line_total: lineTotal,
      cost_source: costSource,
    })
  }

  // ── Aggregate task service costs ──
  // Tasks linked to this production run may have actual_cost set by the partner
  let serviceCost = 0
  const serviceCostItems: any[] = []

  try {
    const taskService = container.resolve("tasks") as any
    // Find tasks linked to this production run via metadata
    const [tasks] = await taskService.listAndCountTasks(
      { metadata: { production_run_id: runId } },
      { take: 100 }
    )
    for (const task of (tasks || [])) {
      const taskCost = Number(task.actual_cost) || Number(task.estimated_cost) || 0
      if (taskCost > 0) {
        serviceCost += taskCost
        serviceCostItems.push({
          task_id: task.id,
          title: task.title,
          estimated_cost: Number(task.estimated_cost) || 0,
          actual_cost: Number(task.actual_cost) || 0,
          cost_used: taskCost,
          cost_source: task.actual_cost ? "actual" : "estimated",
        })
      }
    }
  } catch {
    // Non-fatal — tasks may not exist or metadata filter may not work
  }

  // Use partner's cost estimate if provided, otherwise fall back to service costs + overhead
  const partnerEstimate = Number(run.partner_cost_estimate) || 0
  let productionCost: number
  let costSource: string
  if (partnerEstimate > 0) {
    productionCost = partnerEstimate
    costSource = "partner_estimate"
  } else if (serviceCost > 0) {
    productionCost = serviceCost
    costSource = "task_costs"
  } else {
    productionCost = materialCost * (DEFAULT_PRODUCTION_OVERHEAD_PERCENT / 100)
    costSource = "overhead_percent"
  }

  const totalEstimate = Math.round((materialCost + productionCost) * 100) / 100

  try {
    await designService.updateDesigns({
      id: designId,
      estimated_cost: totalEstimate,
      material_cost: Math.round(materialCost * 100) / 100,
      production_cost: Math.round(productionCost * 100) / 100,
      cost_breakdown: {
        items,
        service_costs: serviceCostItems.length > 0 ? serviceCostItems : undefined,
        service_cost_total: serviceCost > 0 ? Math.round(serviceCost * 100) / 100 : undefined,
        production_cost_source: costSource,
        production_overhead_percent: costSource === "overhead_percent" ? DEFAULT_PRODUCTION_OVERHEAD_PERCENT : undefined,
        partner_cost_estimate: partnerEstimate > 0 ? partnerEstimate : undefined,
        calculated_at: new Date().toISOString(),
        source: "sample_consumption",
        production_run_id: runId,
      },
    })
    console.log(
      `[sample-run-completed] Design ${designId}: material=${materialCost}, service=${serviceCost}, production=${productionCost}, total=${totalEstimate}`
    )
  } catch (e: any) {
    console.error(`[sample-run-completed] Failed to update design ${designId}:`, e.message)
  }
}

export const config: SubscriberConfig = {
  event: "production_run.completed",
}
