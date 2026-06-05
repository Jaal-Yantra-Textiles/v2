import { MedusaContainer } from "@medusajs/framework/types"
import { MedusaError } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "./index"
import type ProductionRunService from "./service"
import { CONSUMPTION_LOG_MODULE } from "../consumption_log"
import type ConsumptionLogService from "../consumption_log/service"
import { ENERGY_RATES_MODULE } from "../energy_rates"
import type EnergyRateService from "../energy_rates/service"

/**
 * Compute a production run's cost summary — material + energy + labor +
 * partner estimate → grand total + cost per unit. Extracted from the
 * admin cost-summary route so the partner-side route can reuse the exact
 * same computation (roadmap #6 Phase 5). Pure aside from the reads it
 * does; never mutates.
 */
export type RunCostSummary = {
  production_run_id: string
  design_id: string
  status: string
  quantity: number
  produced_quantity: number | null
  rejected_quantity: number | null
  material: { total: number; items: any[] }
  energy: { total: number; breakdown: any[] }
  labor: { total: number; total_hours: number; rate_per_hour: number | null }
  partner: { estimate: number | null; cost_type: string; total: number | null }
  grand_total: number | null
  cost_per_unit: number | null
  total_consumption_logs: number
}

export async function computeRunCostSummary(
  container: MedusaContainer,
  runId: string
): Promise<RunCostSummary> {
  const productionRunService: ProductionRunService =
    container.resolve(PRODUCTION_RUNS_MODULE)
  const consumptionLogService: ConsumptionLogService =
    container.resolve(CONSUMPTION_LOG_MODULE)
  const energyRateService: EnergyRateService =
    container.resolve(ENERGY_RATES_MODULE)

  const run = await productionRunService
    .retrieveProductionRun(runId)
    .catch(() => null)
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }

  const [logs] = await consumptionLogService.listAndCountConsumptionLogs(
    { production_run_id: runId },
    { take: null }
  )

  const materialTypes = ["sample", "production", "wastage"]
  const energyTypes = ["energy_electricity", "energy_water", "energy_gas"]

  const materialLogs = logs.filter((l: any) =>
    materialTypes.includes(l.consumption_type)
  )
  const energyLogs = logs.filter((l: any) =>
    energyTypes.includes(l.consumption_type)
  )
  const laborLogs = logs.filter((l: any) => l.consumption_type === "labor")

  const [activeRates] = await energyRateService.listAndCountEnergyRates(
    { is_active: true },
    { take: null }
  )
  const rateMap = new Map<string, any>()
  for (const rate of activeRates) {
    const key = (rate as any).energy_type
    const existing = rateMap.get(key)
    if (
      !existing ||
      new Date((rate as any).effective_from) > new Date(existing.effective_from)
    ) {
      rateMap.set(key, rate)
    }
  }

  // Material
  let materialTotal = 0
  const materialItems = materialLogs.map((log: any) => {
    const lineTotal =
      log.unit_cost != null ? log.quantity * Number(log.unit_cost) : null
    if (lineTotal != null) materialTotal += lineTotal
    return {
      consumption_log_id: log.id,
      inventory_item_id: log.inventory_item_id,
      consumption_type: log.consumption_type,
      quantity: log.quantity,
      unit_cost: log.unit_cost != null ? Number(log.unit_cost) : null,
      unit_of_measure: log.unit_of_measure,
      line_total: lineTotal,
      notes: log.notes,
    }
  })

  // Energy
  let energyTotal = 0
  const energySummary: any[] = []
  const energyByType = new Map<string, any[]>()
  for (const log of energyLogs) {
    const type = (log as any).consumption_type
    if (!energyByType.has(type)) energyByType.set(type, [])
    energyByType.get(type)!.push(log)
  }
  for (const [energyType, typeLogs] of energyByType) {
    const totalQty = typeLogs.reduce((s: number, l: any) => s + l.quantity, 0)
    const rate = rateMap.get(energyType)
    const ratePerUnit = rate ? Number((rate as any).rate_per_unit) : null

    let typeCost: number | null = null
    const logsWithCost = typeLogs.filter((l: any) => l.unit_cost != null)
    if (logsWithCost.length > 0) {
      typeCost = logsWithCost.reduce(
        (s: number, l: any) => s + l.quantity * Number(l.unit_cost),
        0
      )
      const logsWithoutCost = typeLogs.filter((l: any) => l.unit_cost == null)
      if (logsWithoutCost.length > 0 && ratePerUnit != null) {
        typeCost += logsWithoutCost.reduce(
          (s: number, l: any) => s + l.quantity * ratePerUnit,
          0
        )
      }
    } else if (ratePerUnit != null) {
      typeCost = totalQty * ratePerUnit
    }
    if (typeCost != null) energyTotal += typeCost

    energySummary.push({
      energy_type: energyType,
      total_quantity: totalQty,
      unit_of_measure: typeLogs[0]?.unit_of_measure || "Other",
      rate_per_unit: ratePerUnit,
      total_cost: typeCost,
    })
  }

  // Labor
  let laborTotal = 0
  const laborRate = rateMap.get("labor")
  const laborRatePerUnit = laborRate
    ? Number((laborRate as any).rate_per_unit)
    : null
  const totalLaborHours = laborLogs.reduce(
    (s: number, l: any) => s + l.quantity,
    0
  )
  const laborLogsWithCost = laborLogs.filter((l: any) => l.unit_cost != null)
  if (laborLogsWithCost.length > 0) {
    laborTotal = laborLogsWithCost.reduce(
      (s: number, l: any) => s + l.quantity * Number(l.unit_cost),
      0
    )
    const laborLogsWithoutCost = laborLogs.filter((l: any) => l.unit_cost == null)
    if (laborLogsWithoutCost.length > 0 && laborRatePerUnit != null) {
      laborTotal += laborLogsWithoutCost.reduce(
        (s: number, l: any) => s + l.quantity * laborRatePerUnit,
        0
      )
    }
  } else if (laborRatePerUnit != null) {
    laborTotal = totalLaborHours * laborRatePerUnit
  }

  // Partner estimate
  const partnerCost = (run as any).partner_cost_estimate
    ? Number((run as any).partner_cost_estimate)
    : null
  const costType = (run as any).cost_type || "total"
  let partnerTotal: number | null = null
  if (partnerCost != null) {
    partnerTotal =
      costType === "per_unit"
        ? partnerCost * ((run as any).quantity || 1)
        : partnerCost
  }

  const knownCosts = [materialTotal, energyTotal, laborTotal, partnerTotal].filter(
    (c): c is number => c != null && c > 0
  )
  const grandTotal =
    knownCosts.length > 0 ? knownCosts.reduce((a, b) => a + b, 0) : null
  const producedQty =
    (run as any).produced_quantity || (run as any).quantity || 1
  const costPerUnit = grandTotal != null ? grandTotal / producedQty : null

  return {
    production_run_id: runId,
    design_id: (run as any).design_id,
    status: (run as any).status,
    quantity: (run as any).quantity,
    produced_quantity: (run as any).produced_quantity ?? null,
    rejected_quantity: (run as any).rejected_quantity ?? null,
    material: { total: materialTotal, items: materialItems },
    energy: { total: energyTotal, breakdown: energySummary },
    labor: {
      total: laborTotal,
      total_hours: totalLaborHours,
      rate_per_hour: laborRatePerUnit,
    },
    partner: { estimate: partnerCost, cost_type: costType, total: partnerTotal },
    grand_total: grandTotal,
    cost_per_unit: costPerUnit,
    total_consumption_logs: logs.length,
  }
}
