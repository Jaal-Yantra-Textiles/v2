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

  const [allDesignLogs] = await consumptionLogService.listAndCountConsumptionLogs(
    { design_id: designId, is_committed: true },
    { take: 500 }
  )

  // Scope to logs from this specific run to avoid inflating costs
  // when multiple runs exist for the same design
  const logs = allDesignLogs.filter(
    (log: any) => log.production_run_id === runId
  )

  if (!logs.length) {
    console.log(`[sample-run-completed] Design ${designId} / Run ${runId}: no committed logs for this run — skipping`)
    return
  }

  let materialCost = 0
  const items: any[] = []

  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

  // Separate logs by category
  const materialTypes = ["sample", "production", "wastage"]
  const energyTypes = ["energy_electricity", "energy_water", "energy_gas"]
  const materialLogs = logs.filter((l: any) => materialTypes.includes(l.consumption_type))
  const energyLogs = logs.filter((l: any) => energyTypes.includes(l.consumption_type))
  const laborLogs = logs.filter((l: any) => l.consumption_type === "labor")

  // Fetch active energy rates for cost fallback
  let rateMap = new Map<string, number>()
  try {
    const energyRateService = container.resolve("energy_rates") as any
    const [activeRates] = await energyRateService.listAndCountEnergyRates(
      { is_active: true },
      { take: null }
    )
    for (const rate of activeRates) {
      const key = (rate as any).energy_type
      const existing = rateMap.get(key)
      // Keep the most recent rate per type
      if (!existing || Number((rate as any).rate_per_unit) > 0) {
        rateMap.set(key, Number((rate as any).rate_per_unit))
      }
    }
  } catch {
    // energy_rates module may not be available
  }

  // Process material logs
  for (const log of materialLogs) {
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

  // Process energy logs — use log unit_cost or fall back to active rate
  let energyCost = 0
  const energyItems: any[] = []
  for (const log of energyLogs) {
    const qty = Number(log.quantity)
    let unitCost = Number(log.unit_cost) || 0
    let costSource = "partner_input"

    if (!unitCost) {
      const rate = rateMap.get(log.consumption_type) || 0
      if (rate > 0) {
        unitCost = rate
        costSource = "energy_rate"
      } else {
        costSource = "none"
      }
    }

    const lineTotal = qty * unitCost
    energyCost += lineTotal
    energyItems.push({
      consumption_type: log.consumption_type,
      quantity: qty,
      unit_cost: unitCost,
      unit_of_measure: log.unit_of_measure,
      line_total: lineTotal,
      cost_source: costSource,
    })
  }

  // Process labor logs — use log unit_cost or fall back to labor rate
  let laborCost = 0
  let laborHours = 0
  for (const log of laborLogs) {
    const qty = Number(log.quantity)
    laborHours += qty
    let unitCost = Number(log.unit_cost) || 0

    if (!unitCost) {
      unitCost = rateMap.get("labor") || 0
    }

    laborCost += qty * unitCost
  }

  // ── Aggregate task service costs ──
  // Tasks linked to this production run may have actual_cost set by the partner
  let serviceCost = 0
  const serviceCostItems: any[] = []

  try {
    // Find tasks linked to this production run via the remote link
    const { data: runWithTasks } = await query.graph({
      entity: "production_runs",
      fields: ["id", "tasks.id", "tasks.title", "tasks.actual_cost", "tasks.estimated_cost"],
      filters: { id: runId },
    })
    const tasks = (runWithTasks?.[0] as any)?.tasks || []
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

  // Total = material + production + energy + labor
  const totalEstimate = Math.round((materialCost + productionCost + energyCost + laborCost) * 100) / 100

  try {
    await designService.updateDesigns({
      id: designId,
      estimated_cost: totalEstimate,
      material_cost: Math.round(materialCost * 100) / 100,
      production_cost: Math.round(productionCost * 100) / 100,
      cost_breakdown: {
        items,
        energy_costs: energyItems.length > 0 ? energyItems : undefined,
        energy_cost_total: energyCost > 0 ? Math.round(energyCost * 100) / 100 : undefined,
        labor_cost_total: laborCost > 0 ? Math.round(laborCost * 100) / 100 : undefined,
        labor_hours: laborHours > 0 ? laborHours : undefined,
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
      `[sample-run-completed] Design ${designId}: material=${materialCost}, energy=${energyCost}, labor=${laborCost}, production=${productionCost}, total=${totalEstimate}`
    )
  } catch (e: any) {
    console.error(`[sample-run-completed] Failed to update design ${designId}:`, e.message)
  }
}

export const config: SubscriberConfig = {
  event: "production_run.completed",
}
