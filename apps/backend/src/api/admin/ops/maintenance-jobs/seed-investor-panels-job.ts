import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { STATS_MODULE } from "../../../../modules/stats"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const DASHBOARD_NAME = "Investor Projections"

const paramsSchema = z.object({
  panel_names: z
    .string()
    .optional()
    .describe(
      'Comma-separated panel names to seed (default: all). E.g. "GMV projection,GMV trend"'
    ),
})

const PANEL_DEFS = [
  {
    name: "GMV projection",
    type: "metric",
    x: 0, y: 0, width: 6, height: 2,
    operation_type: "gmv_projection",
    operation_options: { currency: "INR", window_days: 90 },
  },
  {
    name: "GMV trend",
    type: "area",
    x: 6, y: 0, width: 6, height: 2,
    operation_type: "time_series",
    operation_options: {
      entity: "marketing_metric_snapshot",
      dateField: "captured_for_date",
      filters: { metric_key: "platform_net_gmv" },
      aggregate: { fn: "sum", field: "value" },
      precision: "week",
      range: { last_days: 90 },
    },
  },
  {
    name: "Unique visitors (30d)",
    type: "line",
    x: 0, y: 2, width: 6, height: 2,
    operation_type: "time_series",
    operation_options: {
      entity: "analytics_daily_stats",
      dateField: "date",
      aggregate: { fn: "sum", field: "unique_visitors" },
      precision: "day",
      range: { last_days: 30 },
    },
  },
  {
    name: "Conversion rate (30d avg)",
    type: "metric",
    x: 6, y: 2, width: 6, height: 2,
    operation_type: "aggregate_data",
    operation_options: {
      entity: "marketing_metric_snapshot",
      dateField: "captured_for_date",
      filters: { metric_key: "storefront_conversion_rate" },
      aggregate: { fn: "avg", field: "value" },
      range: { last_days: 30 },
    },
  },
  {
    name: "Ads efficiency (30d)",
    type: "metric",
    x: 0, y: 4, width: 12, height: 2,
    operation_type: "ads_efficiency",
    operation_options: { last_days: 30, base_currency: "INR" },
  },
]

export const seedInvestorPanelsJob: MaintenanceJob = {
  id: "seed-investor-panels",
  label: "Seed investor projection panels",
  description:
    "Find or create the 'Investor Projections' dashboard and seed its 5 default panels " +
    "(GMV projection, GMV trend, Unique visitors, Conversion rate, Ads efficiency). " +
    "Idempotent — re-running updates existing panels in place. " +
    "Use panel_names to seed a subset (comma-separated).",
  params: [
    {
      name: "panel_names",
      type: "string",
      required: false,
      description:
        'Comma-separated panel names to seed (default: all). E.g. "GMV projection,GMV trend"',
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }

    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const stats: any = container.resolve(STATS_MODULE)

    const filterNames = parsed.data.panel_names
      ? parsed.data.panel_names.split(",").map((s) => s.trim()).filter(Boolean)
      : null

    const defs = filterNames
      ? PANEL_DEFS.filter((d) => filterNames.includes(d.name))
      : PANEL_DEFS

    if (!defs.length) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        filterNames
          ? `No matching panels for: ${filterNames.join(", ")}. ` +
            `Available: ${PANEL_DEFS.map((d) => d.name).join(", ")}`
          : "No panel definitions found"
      )
    }

    const changes: MaintenanceChange[] = []

    // Find or create the dashboard.
    const existing = await stats.listStatsDashboards({ name: DASHBOARD_NAME }, { take: 1 })
    let dashboard = (existing || [])[0]
    let dashboardAction: "created" | "reused" = "reused"

    if (!dashboard) {
      if (!dry_run) {
        ;[dashboard] = await stats.createStatsDashboards([
          {
            name: DASHBOARD_NAME,
            description: "Growth, marketing efficiency and valuation metrics shown to investors.",
            icon: "arrow-trending-up",
            color: "#3b82f6",
            metadata: { investor: true },
          },
        ])
      }
      dashboardAction = "created"
      changes.push({
        entity: "stats_dashboard",
        id: DASHBOARD_NAME,
        field: "dashboard",
        before: null,
        after: { name: DASHBOARD_NAME, metadata: { investor: true } },
      })
      logger.info(`${dry_run ? "[dry-run] Would create" : "Created"} dashboard ${DASHBOARD_NAME}`)
    } else {
      logger.info(`${dry_run ? "[dry-run] Would reuse" : "Reusing"} dashboard ${dashboard.id}`)
    }

    // Fetch existing panels for idempotent upsert.
    const currentPanels = await stats.listStatsPanels(
      { dashboard_id: dashboard?.id ?? "__missing__" },
      { take: 500 }
    )
    const byName = new Map<string, any>()
    for (const p of currentPanels || []) byName.set(p.name, p)

    for (const spec of defs) {
      const found = byName.get(spec.name)
      const payload = {
        dashboard_id: dashboard?.id ?? "__dry__",
        name: spec.name,
        type: spec.type,
        x: spec.x,
        y: spec.y,
        width: spec.width,
        height: spec.height,
        operation_type: spec.operation_type,
        operation_options: spec.operation_options,
        display: {},
        cache_ttl_seconds: 300,
        metadata: { investor: true },
      }

      if (found) {
        changes.push({
          entity: "stats_panel",
          id: found.id,
          field: "panel",
          before: { name: spec.name, operation_type: found.operation_type },
          after: { name: spec.name, operation_type: spec.operation_type },
        })
        if (!dry_run) {
          await stats.updateStatsPanels({ id: found.id, ...payload })
        }
        logger.info(`${dry_run ? "[dry-run] Would update" : "Updated"} panel "${spec.name}"`)
      } else {
        changes.push({
          entity: "stats_panel",
          id: spec.name,
          field: "panel",
          before: null,
          after: { name: spec.name, operation_type: spec.operation_type },
        })
        if (!dry_run) {
          await stats.createStatsPanels([payload])
        }
        logger.info(`${dry_run ? "[dry-run] Would create" : "Created"} panel "${spec.name}"`)
      }
    }

    const created = changes.filter((c) => c.field === "panel" && c.before === null).length
    const updated = changes.filter((c) => c.field === "panel" && c.before !== null).length
    const verb = dry_run ? "Would seed" : "Seeded"

    return {
      job_id: seedInvestorPanelsJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary:
        `${verb} ${defs.length} panel(s) on dashboard "${DASHBOARD_NAME}": ` +
        `${created} created, ${updated} updated, dashboard ${dashboardAction}.`,
      changes,
    }
  },
}

export default seedInvestorPanelsJob
