/**
 * Script: Calculate design estimated_cost from completed sample production runs.
 *
 * When a sample production run completes, this script can be run to:
 * 1. Find all committed consumption logs for the design
 * 2. Look up unit_cost for each inventory item consumed
 * 3. Calculate total material cost = Σ(quantity × unit_cost)
 * 4. Add production overhead (default 30%)
 * 5. Write the result to design.estimated_cost
 *
 * Usage:
 *   npx medusa exec src/scripts/calculate-sample-cost.ts -- --design_id=01KE6E3NY88RB64J6D1CCT0E0C
 *   npx medusa exec src/scripts/calculate-sample-cost.ts -- --production_run_id=prod_run_xxx
 *   npx medusa exec src/scripts/calculate-sample-cost.ts -- --all-samples
 *
 * Can also be called programmatically from a subscriber on production_run.completed.
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const DEFAULT_PRODUCTION_OVERHEAD_PERCENT = 30

export default async function calculateSampleCost({ container, args }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const designService = container.resolve("design") as any
  const consumptionLogService = container.resolve("consumption_log") as any
  const productionRunService = container.resolve("production_runs") as any

  const a = args as any || {}
  const designId = a.design_id as string | undefined
  const runId = a.production_run_id as string | undefined
  const allSamples = a["all-samples"] !== undefined

  // Resolve design IDs to process
  const designIds: string[] = []

  if (designId) {
    designIds.push(designId)
  } else if (runId) {
    const run = await productionRunService.retrieveProductionRun(runId)
    if (!run) {
      console.error(`Production run ${runId} not found`)
      return
    }
    if (run.run_type !== "sample") {
      console.warn(`Production run ${runId} is not a sample run (type: ${run.run_type})`)
    }
    designIds.push(run.design_id)
  } else if (allSamples) {
    // Find all designs with completed sample runs that don't have estimated_cost set
    const [runs] = await productionRunService.listAndCountProductionRuns(
      { run_type: "sample", status: "completed" },
      { take: 500 }
    )
    const uniqueDesignIds = [...new Set(runs.map((r: any) => r.design_id))] as string[]
    designIds.push(...uniqueDesignIds)
    console.log(`Found ${uniqueDesignIds.length} designs with completed sample runs`)
  } else {
    console.log("Usage: --design_id=xxx | --production_run_id=xxx | --all-samples")
    return
  }

  for (const dId of designIds) {
    try {
      // Find the latest completed sample run for this design to get partner_cost_estimate
      let partnerCostEstimate = 0
      try {
        const [sampleRuns] = await productionRunService.listAndCountProductionRuns(
          { design_id: dId, run_type: "sample", status: "completed" },
          { take: 1, order: { completed_at: "DESC" } }
        )
        if (sampleRuns?.[0]?.partner_cost_estimate) {
          partnerCostEstimate = Number(sampleRuns[0].partner_cost_estimate)
        }
      } catch { /* non-fatal */ }

      await calculateCostForDesign(
        dId,
        consumptionLogService,
        inventoryService,
        designService,
        query,
        partnerCostEstimate
      )
    } catch (e: any) {
      console.error(`Failed to calculate cost for design ${dId}:`, e.message)
    }
  }

  console.log("Done.")
}

async function calculateCostForDesign(
  designId: string,
  consumptionLogService: any,
  inventoryService: any,
  designService: any,
  query: any,
  partnerCostEstimate: number
) {
  const [logs] = await consumptionLogService.listAndCountConsumptionLogs(
    { design_id: designId, is_committed: true },
    { take: 500 }
  )

  if (!logs.length) {
    console.log(`  Design ${designId}: No committed consumption logs — skipping`)
    return
  }

  let materialCost = 0
  const breakdown: Array<{
    inventory_item_id: string
    title: string
    quantity: number
    unit_cost: number
    line_total: number
    cost_source: string
  }> = []

  for (const log of logs) {
    let unitCost = Number(log.unit_cost) || 0
    let costSource = "partner_input"
    let title = log.inventory_item_id

    // Resolve title
    try {
      const item = await inventoryService.retrieveInventoryItem(log.inventory_item_id)
      title = item.title || item.sku || log.inventory_item_id

      // Fall back to raw_material.unit_cost if log has none
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
    } catch {
      console.warn(`  Inventory item ${log.inventory_item_id} not found — using cost 0`)
      costSource = "none"
    }

    const lineTotal = Number(log.quantity) * unitCost
    materialCost += lineTotal

    breakdown.push({
      inventory_item_id: log.inventory_item_id,
      title,
      quantity: Number(log.quantity),
      unit_cost: unitCost,
      line_total: lineTotal,
      cost_source: costSource,
    })
  }

  // Use partner cost estimate if provided, otherwise fall back to overhead %
  const productionCost = partnerCostEstimate > 0
    ? partnerCostEstimate
    : materialCost * (DEFAULT_PRODUCTION_OVERHEAD_PERCENT / 100)
  const costSource = partnerCostEstimate > 0 ? "partner_estimate" : "overhead_percent"
  const totalEstimate = Math.round((materialCost + productionCost) * 100) / 100

  console.log(`  Design ${designId}:`)
  console.log(`    Material cost: ${materialCost}`)
  console.log(`    Production cost (${costSource}): ${productionCost}`)
  console.log(`    Total estimate: ${totalEstimate}`)
  for (const item of breakdown) {
    console.log(`      ${item.title}: ${item.quantity} × ${item.unit_cost} = ${item.line_total}`)
  }

  await designService.updateDesigns({
    id: designId,
    estimated_cost: totalEstimate,
    material_cost: Math.round(materialCost * 100) / 100,
    production_cost: Math.round(productionCost * 100) / 100,
    cost_breakdown: {
      items: breakdown,
      production_cost_source: costSource,
      production_overhead_percent: costSource === "overhead_percent" ? DEFAULT_PRODUCTION_OVERHEAD_PERCENT : undefined,
      partner_cost_estimate: partnerCostEstimate > 0 ? partnerCostEstimate : undefined,
      calculated_at: new Date().toISOString(),
      source: "sample_consumption",
    },
  })

  console.log(`    → Written to design.estimated_cost = ${totalEstimate}`)
}
