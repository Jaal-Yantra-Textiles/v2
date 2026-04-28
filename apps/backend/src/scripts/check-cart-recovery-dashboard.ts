/**
 * Resolve every panel on the Cart Recovery dashboard and print the
 * shape that would feed the renderer — proves the new operation is
 * registered and returns valid output for each panel type.
 *
 * Run after `seed-cart-recovery-dashboard.ts`:
 *   npx medusa exec ./src/scripts/check-cart-recovery-dashboard.ts
 *
 * Validation rules per panel type:
 *   - metric: data must expose either `value` or `data[display.field]`
 *   - bar:    data.groups must be an array
 *   - line:   data.buckets must be an array
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../modules/stats"
import { resolvePanel } from "../modules/stats/resolver"

const DASHBOARD_NAME = "Cart Recovery"

export default async function checkCartRecoveryDashboard({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(STATS_MODULE)

  const [dashboards] = await service.listAndCountStatsDashboards(
    { name: DASHBOARD_NAME },
    { take: 1 },
  )
  const dashboard = dashboards[0]
  if (!dashboard) {
    throw new Error(
      `Dashboard "${DASHBOARD_NAME}" not found — run seed-cart-recovery-dashboard.ts first.`,
    )
  }

  const panels = await service.listStatsPanels(
    { dashboard_id: dashboard.id },
    { take: 50, order: { y: "ASC" } },
  )

  logger.info(`Resolving ${panels.length} panels on "${DASHBOARD_NAME}" (id=${dashboard.id})`)
  logger.info("─".repeat(72))

  let failures = 0
  for (const panel of panels) {
    try {
      const result = await resolvePanel(container, panel, { skipCache: true })
      const data: any = (result as any).data ?? {}

      let summary: string
      let ok = false
      if (panel.type === "metric") {
        const field = (panel.display as any)?.field ?? "value"
        const v = data[field] ?? data.value
        ok = v !== undefined && v !== null
        summary = ok ? `value=${JSON.stringify(v)}` : `MISSING field "${field}"`
      } else if (panel.type === "bar") {
        ok = Array.isArray(data.groups)
        summary = ok
          ? `groups=${data.groups.length} → ${JSON.stringify(data.groups)}`
          : "MISSING groups[]"
      } else if (panel.type === "line" || panel.type === "area") {
        ok = Array.isArray(data.buckets)
        const sample = ok ? data.buckets.slice(0, 3) : null
        summary = ok
          ? `buckets=${data.buckets.length} sample=${JSON.stringify(sample)}`
          : "MISSING buckets[]"
      } else {
        ok = true
        summary = `(unchecked panel type ${panel.type})`
      }

      logger.info(`${ok ? "✅" : "❌"} ${panel.type.padEnd(6)} ${panel.name}`)
      logger.info(`     ${summary}`)
      if (!ok) failures++
    } catch (err: any) {
      logger.error(`❌ ${panel.type.padEnd(6)} ${panel.name} — ${err.message}`)
      failures++
    }
  }

  logger.info("─".repeat(72))
  if (failures > 0) {
    throw new Error(`${failures} panel(s) failed to resolve.`)
  }
  logger.info(`All ${panels.length} panels resolved cleanly.`)
}
