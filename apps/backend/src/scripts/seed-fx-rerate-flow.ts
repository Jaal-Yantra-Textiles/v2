/**
 * Seed: FX Rates — Daily Re-rate Auto-converted Prices
 *
 * Two-operation visual flow that fires daily at 02:05 UTC and
 * triggers the `rerate-auto-converted-prices` workflow. Runs 5
 * minutes after the refresh-fx-rates flow (02:00 UTC) so the
 * rate cache is fresh before we walk every auto-converted price
 * and recompute its amount.
 *
 * Why a separate flow (vs. chaining onto refresh):
 *   Keeping refresh + rerate as independent flows means an operator
 *   can pause re-rate without losing the daily rate refresh. They
 *   also fail and surface in the visual_flow_execution log
 *   independently — a refresh failure (provider 500) doesn't bury
 *   itself under a downstream rerate failure log.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-fx-rerate-flow.ts
 *
 * Status on first creation:
 *   `draft` — flip to `active` only after both:
 *   1. seed-initial-fx-rates.ts has populated the fx_rate table
 *   2. The fanout subscriber has created at least one fx_price_meta
 *      row (otherwise this flow is a no-op).
 */

import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"

const FLOW_NAME = "FX Rates — Daily Re-rate Auto-converted Prices"
const CRON = "5 2 * * *" // daily 02:05 UTC, 5 min after refresh

const X_CENTER = 500
const Y_TRIGGER = -20
const Y_RERATE = 140

const FLOW_DEF = {
  name: FLOW_NAME,
  description:
    "Daily walk of every fx_price_meta row → recompute amount = " +
    "base_amount × today's rate → update the linked Price + cache " +
    "the new fx_rate. Runs at 02:05 UTC so the rate cache (refreshed " +
    "at 02:00) is current. Manual overrides are untouched because " +
    "strip-on-edit deletes the fx_price_meta row.",
  status: "draft" as const,
  trigger_type: "schedule" as const,
  trigger_config: { cron: CRON },

  canvas_state: {
    viewport: { x: 0, y: 0, zoom: 0.8 },
    nodes: [
      {
        id: "trigger",
        type: "trigger",
        position: { x: X_CENTER, y: Y_TRIGGER },
        data: {
          label: "Schedule — daily 02:05 UTC",
          triggerType: "schedule",
          triggerConfig: { cron: CRON },
        },
      },
      {
        id: "rerate_prices",
        type: "operation",
        position: { x: X_CENTER, y: Y_RERATE },
        data: {
          label: "Re-rate auto-converted prices",
          operationKey: "rerate_prices",
          operationType: "trigger_workflow",
        },
      },
    ],
    edges: [
      {
        id: "e-0",
        source: "trigger",
        sourceHandle: "default",
        target: "rerate_prices",
        targetHandle: "default",
      },
    ],
  },

  operations: [
    {
      operation_key: "rerate_prices",
      operation_type: "trigger_workflow",
      name: "Re-rate auto-converted prices",
      sort_order: 0,
      position_x: X_CENTER,
      position_y: Y_RERATE,
      options: {
        workflow_name: "rerate-auto-converted-prices",
        wait_for_completion: true,
        input: {},
      },
    },
  ],

  connections: [
    {
      source_id: "trigger",
      source_handle: "default",
      target_id: "rerate_prices",
      connection_type: "default" as const,
    },
  ],
}

export default async function seedFxRerateFlow({
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
  console.log(`  1. Confirm refresh-fx-rates flow is active (02:00 UTC).`)
  console.log(`  2. Confirm at least one fx_price_meta row exists (set a`)
  console.log(`     partner variant price → fanout writes them).`)
  console.log(`  3. Flip flow status: draft → active in the admin editor.`)
}
