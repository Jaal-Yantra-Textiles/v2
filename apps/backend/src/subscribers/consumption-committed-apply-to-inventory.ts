import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"

import { applyCommittedConsumptionJob } from "../api/admin/ops/maintenance-jobs/apply-committed-consumption-job"
import { CONSUMPTION_LOG_MODULE } from "../modules/consumption_log"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import { CONSUMPTION_COMMITTED_EVENT } from "../workflows/consumption-logs/commit-consumption"

/**
 * #2406 — committing material consumption takes it off OUR stock, automatically.
 *
 * Committing has always been cost-only, and the deduction lived in a maintenance
 * job nobody ran: on 2026-10-12, 158 committed logs on prod had moved no stock
 * at all. This runs that same job, scoped to exactly the logs just committed,
 * so the ownership rules (our locations only, consignment, partner-held cloth
 * skipped) stay in one place.
 *
 * SERIALISED. The job writes ABSOLUTE levels computed from a read, and a partner
 * completing a run commits one log per material in quick succession — two
 * handlers interleaving on one item would each subtract from the same starting
 * balance and lose a deduction. The chain below keeps this process to one apply
 * at a time; the job's `inventory_applied_at` stamp makes a re-delivered event a
 * no-op.
 *
 * Not silent: the outcome (what came off, and what was skipped and why) is
 * written to each affected run's activity feed. Best-effort — a failure is
 * logged and the logs stay committed-but-unapplied, which the job can sweep.
 */
let chain: Promise<unknown> = Promise.resolve()

export default async function consumptionCommittedApplyToInventoryHandler({
  event: { data },
  container,
}: SubscriberArgs<{ log_ids?: string[] }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const logIds = (data?.log_ids ?? []).filter(Boolean)
  if (!logIds.length) {
    return
  }

  const run = async () => {
    try {
      const result = await applyCommittedConsumptionJob.run(container, {
        dry_run: false,
        params: { log_ids: logIds },
      })
      logger.info(
        `[consumption-apply] ${logIds.length} committed log(s): ${result.summary}`
      )
      await noteOnRuns(container, logger, logIds, result)
    } catch (e: any) {
      logger.error(
        `[consumption-apply] failed for logs ${logIds.join(", ")}: ${e?.message ?? e}`
      )
    }
  }

  chain = chain.then(run, run)
  await chain
}

async function noteOnRuns(
  container: any,
  logger: Logger,
  logIds: string[],
  result: { summary: string; changes?: Array<Record<string, any>> }
) {
  const logService: any = container.resolve(CONSUMPTION_LOG_MODULE)
  const runService: any = container.resolve(PRODUCTION_RUNS_MODULE)

  const [logs] = await logService.listAndCountConsumptionLogs(
    { id: logIds },
    { take: null }
  )
  const runIds = Array.from(
    new Set(((logs || []) as any[]).map((l) => l.production_run_id).filter(Boolean))
  ) as string[]

  for (const runId of runIds) {
    try {
      const run = await runService.retrieveProductionRun(runId)
      await runService.createProductionRunActivities({
        production_run_id: runId,
        activity_type: "system",
        kind: "consumption_applied",
        actor_type: "system",
        actor_id: null,
        partner_id: run?.partner_id ?? null,
        channel: null,
        message_id: null,
        template_name: null,
        recipient: null,
        summary: `Material stock: ${result.summary}`,
        payload: {
          log_ids: logIds,
          changes: result.changes ?? [],
        },
        // NOT NULL with no default: leaving it out failed every insert, and
        // the swallowed error hid it (prod, 2026-10-13: stock moved, no note).
        occurred_at: new Date(),
      })
    } catch (e: any) {
      // The timeline is an audit mirror; the stock movement already happened.
      // Still say so, or a missing note reads as "nothing was applied".
      logger.warn(
        `[consumption-apply] could not note run ${runId}: ${e?.message ?? e}`
      )
    }
  }
}

export const config: SubscriberConfig = {
  event: CONSUMPTION_COMMITTED_EVENT,
}
