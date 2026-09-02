import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../../../../modules/stats"
import {
  DASHBOARD_NAME,
  PANEL_NAME,
  PLATFORM_STATS_PANEL_DEF,
} from "../../../../scripts/seed-platform-stats-panel"
import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — seed / re-sync the public "Platform snapshot" stats panel.
 *
 * Wraps `seed-platform-stats-panel.ts` (the canonical `operation_options`) so
 * the panel can be (re)applied from Settings → Data Plumbing with a dry-run
 * preview, no shell or `medusa exec`. This is the mechanism that pushes a new
 * metric section live: edit the seed's `OPERATION_OPTIONS.sections`, then run
 * this job with apply — the existing panel is updated in place (matched by
 * name) rather than duplicated.
 *
 * Idempotent: re-running updates the existing dashboard + panel in place.
 */
export const seedPlatformStatsPanelJob: MaintenanceJob = {
  id: "seed-platform-stats-panel",
  label: "Seed / update Platform snapshot stats panel",
  description:
    "Find or create the 'Platform Stats' dashboard and seed its 'Platform snapshot' panel from seed-platform-stats-panel.ts — orders, commissions, partner orders, net accrued fees, partner payout pipeline (paid / approved / in review / count), ARR, AOV and artisan-subscription MRR, all derived live from partner_fees, order_transactions, partner_subscriptions and payment_submissions. Idempotent — re-running updates the existing panel in place. This is how a new metric section goes live: edit the seed's operation_options.sections, then run this job with apply.",
  params: [],
  run: async (container, { dry_run }): Promise<MaintenanceJobResult> => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const stats: any = container.resolve(STATS_MODULE)

    const changes: MaintenanceChange[] = []

    const existing = await stats.listStatsDashboards(
      { name: DASHBOARD_NAME },
      { take: 1 }
    )
    let dashboard = (existing || [])[0]
    let dashboardAction: "created" | "reused" = "reused"

    if (!dashboard) {
      if (!dry_run) {
        ;[dashboard] = await stats.createStatsDashboards([
          {
            name: DASHBOARD_NAME,
            description:
              "Orders, commissions, partner orders, net fees, payouts, ARR, AOV and artisan-subscription MRR — all derived from live rows.",
            icon: "chart-no-axes-combined",
            color: "#10b981",
          },
        ])
      }
      dashboardAction = "created"
      changes.push({
        entity: "stats_dashboard",
        id: DASHBOARD_NAME,
        field: "dashboard",
        before: null,
        after: { name: DASHBOARD_NAME },
      })
      logger.info(
        `${dry_run ? "[dry-run] Would create" : "Created"} dashboard ${DASHBOARD_NAME}`
      )
    } else {
      logger.info(
        `${dry_run ? "[dry-run] Would reuse" : "Reusing"} dashboard ${dashboard.id}`
      )
    }

    const currentPanels = await stats.listStatsPanels(
      { dashboard_id: dashboard?.id ?? "__missing__", name: PANEL_NAME },
      { take: 1 }
    )
    const found = (currentPanels || [])[0]
    const payload = {
      dashboard_id: dashboard?.id ?? "__dry__",
      ...PLATFORM_STATS_PANEL_DEF,
    }

    const nextSectionKeys = Object.keys(
      (PLATFORM_STATS_PANEL_DEF.operation_options as any).sections ?? {}
    )

    if (found) {
      changes.push({
        entity: "stats_panel",
        id: found.id,
        field: "operation_options.sections",
        before: Object.keys((found.operation_options ?? {}).sections ?? {}),
        after: nextSectionKeys,
      })
      if (!dry_run) {
        await stats.updateStatsPanels({ id: found.id, ...payload })
      }
      logger.info(
        `${dry_run ? "[dry-run] Would update" : "Updated"} panel "${PANEL_NAME}" (${found.id})`
      )
    } else {
      changes.push({
        entity: "stats_panel",
        id: PANEL_NAME,
        field: "panel",
        before: null,
        after: {
          name: PANEL_NAME,
          operation_type: PLATFORM_STATS_PANEL_DEF.operation_type,
          sections: nextSectionKeys,
        },
      })
      if (!dry_run) {
        await stats.createStatsPanels([payload])
      }
      logger.info(
        `${dry_run ? "[dry-run] Would create" : "Created"} panel "${PANEL_NAME}"`
      )
    }

    const verb = dry_run ? "Would seed" : "Seeded"
    return {
      job_id: seedPlatformStatsPanelJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary:
        `${verb} "${PANEL_NAME}" on dashboard "${DASHBOARD_NAME}": ` +
        `dashboard ${dashboardAction}, panel ${found ? "updated" : "created"} ` +
        `(${nextSectionKeys.length} sections).`,
      changes,
    }
  },
}

export default seedPlatformStatsPanelJob