/**
 * Script: Backfill energy & labor costs into existing design cost breakdowns.
 *
 * Finds designs that have completed production runs with energy/labor consumption
 * logs but whose cost_breakdown doesn't include energy_cost_total. Recalculates
 * the full cost using active energy rates and updates the design.
 *
 * Usage:
 *   npx medusa exec src/scripts/backfill-design-energy-costs.ts
 *   npx medusa exec src/scripts/backfill-design-energy-costs.ts -- --design_id=01KE6...
 *   npx medusa exec src/scripts/backfill-design-energy-costs.ts -- --dry-run
 *   npx medusa exec src/scripts/backfill-design-energy-costs.ts -- --force
 *
 * Flags:
 *   --design_id=xxx   Process a single design
 *   --dry-run         Show what would be updated without writing
 *   --force           Update even if cost_breakdown already has energy_cost_total
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const MATERIAL_TYPES = ["sample", "production", "wastage"]
const ENERGY_TYPES = ["energy_electricity", "energy_water", "energy_gas"]

export default async function backfillDesignEnergyCosts({ container, args }: ExecArgs) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  const inventoryService = container.resolve(Modules.INVENTORY) as any
  const designService = container.resolve("design") as any
  const consumptionLogService = container.resolve("consumption_log") as any
  const productionRunService = container.resolve("production_runs") as any
  const energyRateService = container.resolve("energy_rates") as any

  const a = args as any || {}
  const targetDesignId = a.design_id as string | undefined
  const dryRun = a["dry-run"] !== undefined
  const force = a.force !== undefined

  if (dryRun) console.log("[DRY RUN] No changes will be written.\n")

  // 1. Load active energy rates
  const [activeRates] = await energyRateService.listAndCountEnergyRates(
    { is_active: true },
    { take: null }
  )

  const rateMap = new Map<string, { rate_per_unit: number; name: string }>()
  for (const rate of activeRates) {
    const key = (rate as any).energy_type
    const existing = rateMap.get(key)
    if (
      !existing ||
      new Date((rate as any).effective_from) > new Date((existing as any).effective_from || 0)
    ) {
      rateMap.set(key, {
        rate_per_unit: Number((rate as any).rate_per_unit),
        name: (rate as any).name,
      })
    }
  }

  console.log("Active energy rates loaded:")
  for (const [type, info] of rateMap) {
    console.log(`  ${type}: ${info.rate_per_unit} (${info.name})`)
  }
  console.log("")

  // 2. Find designs to process
  let designIds: string[] = []

  if (targetDesignId) {
    designIds = [targetDesignId]
  } else {
    // Find all designs with completed production runs
    const [completedRuns] = await productionRunService.listAndCountProductionRuns(
      { status: "completed" },
      { take: null }
    )
    designIds = [...new Set(completedRuns.map((r: any) => r.design_id))] as string[]
    console.log(`Found ${designIds.length} designs with completed production runs`)
  }

  let updated = 0
  let skipped = 0
  let noLogs = 0

  for (const designId of designIds) {
    try {
      const design = await designService.retrieveDesign(designId)
      if (!design) {
        console.log(`  [SKIP] Design ${designId} not found`)
        skipped++
        continue
      }

      // Check if already has energy costs
      const existingBreakdown = (design as any).cost_breakdown as any
      if (existingBreakdown?.energy_cost_total && !force) {
        console.log(`  [SKIP] ${designId} (${(design as any).name}) — already has energy_cost_total: ${existingBreakdown.energy_cost_total}`)
        skipped++
        continue
      }

      // Get all committed consumption logs for this design
      const [allLogs] = await consumptionLogService.listAndCountConsumptionLogs(
        { design_id: designId, is_committed: true },
        { take: null }
      )

      if (!allLogs.length) {
        noLogs++
        continue
      }

      // Separate by type
      const materialLogs = allLogs.filter((l: any) => MATERIAL_TYPES.includes(l.consumption_type))
      const energyLogs = allLogs.filter((l: any) => ENERGY_TYPES.includes(l.consumption_type))
      const laborLogs = allLogs.filter((l: any) => l.consumption_type === "labor")

      // If no energy or labor logs, nothing to backfill
      if (!energyLogs.length && !laborLogs.length) {
        noLogs++
        continue
      }

      // Calculate material cost (preserve existing)
      let materialCost = 0
      const materialItems: any[] = []
      for (const log of materialLogs) {
        let unitCost = Number(log.unit_cost) || 0
        let costSource = "partner_input"
        let title = log.inventory_item_id || "unknown"

        if (log.inventory_item_id) {
          try {
            const item = await inventoryService.retrieveInventoryItem(log.inventory_item_id)
            title = item.title || item.sku || log.inventory_item_id
          } catch {}

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
        }

        const lineTotal = Number(log.quantity) * unitCost
        materialCost += lineTotal
        materialItems.push({
          inventory_item_id: log.inventory_item_id,
          title,
          quantity: Number(log.quantity),
          unit_cost: unitCost,
          line_total: lineTotal,
          cost_source: costSource,
        })
      }

      // Calculate energy cost
      let energyCost = 0
      const energyItems: any[] = []
      for (const log of energyLogs) {
        const qty = Number(log.quantity)
        let unitCost = Number(log.unit_cost) || 0
        let costSource = "partner_input"

        if (!unitCost) {
          const rateInfo = rateMap.get(log.consumption_type)
          if (rateInfo && rateInfo.rate_per_unit > 0) {
            unitCost = rateInfo.rate_per_unit
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

      // Calculate labor cost
      let laborCost = 0
      let laborHours = 0
      for (const log of laborLogs) {
        const qty = Number(log.quantity)
        laborHours += qty
        let unitCost = Number(log.unit_cost) || 0

        if (!unitCost) {
          const rateInfo = rateMap.get("labor")
          unitCost = rateInfo?.rate_per_unit || 0
        }

        laborCost += qty * unitCost
      }

      // Determine production cost (preserve existing logic)
      let productionCost = Number((design as any).production_cost) || 0
      let productionSource = existingBreakdown?.production_cost_source || "existing"

      // If no production cost was set, estimate
      if (!productionCost) {
        // Find latest completed run for partner estimate
        try {
          const [runs] = await productionRunService.listAndCountProductionRuns(
            { design_id: designId, status: "completed" },
            { take: 1, order: { completed_at: "DESC" } }
          )
          const partnerEst = Number(runs?.[0]?.partner_cost_estimate) || 0
          if (partnerEst > 0) {
            productionCost = partnerEst
            productionSource = "partner_estimate"
          }
        } catch {}

        if (!productionCost) {
          productionCost = materialCost * 0.3
          productionSource = "overhead_percent"
        }
      }

      const round2 = (n: number) => Math.round(n * 100) / 100
      const totalEstimate = round2(materialCost + productionCost + energyCost + laborCost)

      console.log(`  ${designId} (${(design as any).name}):`)
      console.log(`    Material: ${round2(materialCost)} (${materialItems.length} logs)`)
      console.log(`    Energy:   ${round2(energyCost)} (${energyItems.length} logs)`)
      console.log(`    Labor:    ${round2(laborCost)} (${laborHours}h)`)
      console.log(`    Prod:     ${round2(productionCost)} (${productionSource})`)
      console.log(`    Total:    ${totalEstimate}`)
      if (existingBreakdown?.energy_cost_total) {
        console.log(`    (Previous energy_cost_total: ${existingBreakdown.energy_cost_total})`)
      }

      if (!dryRun) {
        await designService.updateDesigns({
          id: designId,
          estimated_cost: totalEstimate,
          material_cost: round2(materialCost),
          production_cost: round2(productionCost),
          cost_breakdown: {
            // Preserve existing material items if we have them, otherwise use new
            items: materialItems.length > 0 ? materialItems : existingBreakdown?.items,
            energy_costs: energyItems.length > 0 ? energyItems : undefined,
            energy_cost_total: energyCost > 0 ? round2(energyCost) : undefined,
            labor_cost_total: laborCost > 0 ? round2(laborCost) : undefined,
            labor_hours: laborHours > 0 ? laborHours : undefined,
            service_costs: existingBreakdown?.service_costs,
            service_cost_total: existingBreakdown?.service_cost_total,
            production_cost_source: productionSource,
            production_overhead_percent: productionSource === "overhead_percent" ? 30 : undefined,
            partner_cost_estimate: existingBreakdown?.partner_cost_estimate,
            calculated_at: new Date().toISOString(),
            source: "backfill_energy_costs",
            previous_estimated_cost: (design as any).estimated_cost || undefined,
          },
        })
        updated++
      } else {
        updated++
      }
    } catch (e: any) {
      console.error(`  [ERROR] Design ${designId}: ${e.message}`)
    }
  }

  console.log("")
  console.log("=== Summary ===")
  console.log(`  Updated:  ${updated}`)
  console.log(`  Skipped:  ${skipped} (already had energy costs)`)
  console.log(`  No logs:  ${noLogs} (no energy/labor consumption logs)`)
  console.log(`  Total:    ${designIds.length}`)
  if (dryRun) console.log("\n[DRY RUN] No changes were written. Remove --dry-run to apply.")
}
