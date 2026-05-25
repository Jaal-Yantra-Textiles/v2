/**
 * Seed: FX Rates — Daily Refresh
 *
 * Single-operation visual flow that fires daily at 02:00 UTC and
 * triggers the `refresh-fx-rates` workflow. The workflow's only job
 * is to call `FxRatesService.refreshRatesFromProvider()` — which
 * fetches the latest rates from the configured provider
 * (open.er-api.com by default) and upserts the `fx_rate` table.
 *
 * Why a visual flow wraps such a thin operation:
 *   1. The schedule lives in the admin UI, not in code — operators
 *      can pause / reschedule / toggle from `/app/visual-flows/{id}`
 *      without a code change.
 *   2. The execution log (visual_flow_execution rows) gives us a
 *      built-in audit trail of each refresh.
 *   3. Future operations can be chained in front of or behind the
 *      refresh without rewriting the trigger setup.
 *
 * Cadence:
 *   `0 2 * * *` — daily at 02:00 UTC. Refreshing once per day is more
 *   than enough at our currency mix; FX moves <0.5% daily on the
 *   major pairs we use (INR/EUR/USD/AUD/GBP).
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-fx-refresh-flow.ts
 *
 * Re-seed:
 *   Delete the existing flow first (admin UI or by id) and re-run.
 *   The script is idempotent and refuses to overwrite by name.
 *
 * Status on first creation:
 *   `draft` — flip to `active` from the admin editor after running
 *   `seed-initial-fx-rates.ts` at least once so there are rates to
 *   refresh.
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "FX Rates — Daily Refresh"

// Canvas positions — single vertical column, tight spacing.
const X_CENTER = 500
const Y_TRIGGER = -20
const Y_REFRESH = 140

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Daily refresh of FX rates via the refresh-fx-rates workflow. " +
    "Fetches from the configured provider (open.er-api.com by default) " +
    "and upserts the fx_rate table. Runs at 02:00 UTC. Idempotent — " +
    "upsert keyed on (base_currency, quote_currency).",
  status: "draft" as const,
  trigger_type: "schedule" as const,
  trigger_config: {
    cron: "0 2 * * *", // daily at 02:00 UTC
  },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: X_CENTER, y: Y_TRIGGER },
        data: {
          label: "Schedule — daily 02:00 UTC",
          triggerType: "schedule",
          triggerConfig: { cron: "0 2 * * *" },
        },
      },
      {
        id: "refresh_rates",
        type: "operation",
        position: { x: X_CENTER, y: Y_REFRESH },
        data: {
          label: "Refresh FX Rates",
          operationKey: "refresh_rates",
          operationType: "trigger_workflow",
        },
      },
    ],
    edges: [
      {
        id: "e-0",
        source: "trigger",
        sourceHandle: "default",
        target: "refresh_rates",
        targetHandle: "default",
      },
    ],
  },

  operations: [
    {
      operation_key: "refresh_rates",
      operation_type: "trigger_workflow",
      name: "Refresh FX Rates",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_REFRESH,
      options: {
        workflow_name: "refresh-fx-rates",
        wait_for_completion: true,
        // The workflow takes no meaningful input — the provider is
        // resolved from the service's configured default. Pass an
        // empty object so the trigger_workflow operation gets a valid
        // payload to forward.
        input: {},
      },
    },
  ],

  connections: [
    {
      source_id: "trigger",
      source_handle: "default",
      target_id: "refresh_rates",
      connection_type: "default" as const,
    },
  ],
}

export default async function seedFxRefreshFlow({
  container,
}: {
  container: any
}) {
  const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)

  const [existing] = await service.listVisualFlows({ name: FLOW_NAME } as any)
  if (existing) {
    console.log(`Flow "${FLOW_NAME}" already exists (${existing.id}) — skipping.`)
    console.log(`Delete it in the admin UI (or by id) to re-seed.`)
    return
  }

  console.log(`Creating flow "${FLOW_NAME}"...`)

  const flow = await service.createCompleteFlow({
    flow: {
      name: FLOW_DEF.name,
      description: FLOW_DEF.description,
      status: FLOW_DEF.status,
      trigger_type: FLOW_DEF.trigger_type,
      trigger_config: FLOW_DEF.trigger_config,
      canvas_state: FLOW_DEF.canvas_state,
    },
    operations: FLOW_DEF.operations,
    connections: FLOW_DEF.connections,
  })

  console.log(`\nFlow created: ${flow.id}`)
  console.log(`  Open: /app/visual-flows/${flow.id}\n`)
  console.log(`Before activating:`)
  console.log(`  1. Run \`npx medusa exec ./src/scripts/seed-initial-fx-rates.ts\` once`)
  console.log(`     so the fx_rate table has rows to refresh.`)
  console.log(`  2. Confirm the cron \`0 2 * * *\` (daily 02:00 UTC) matches the`)
  console.log(`     cadence you want. Adjust trigger_config.cron + the trigger`)
  console.log(`     node's data.triggerConfig.cron in the editor if needed.`)
  console.log(`  3. Flip flow status: draft → active in the admin editor.`)
}
