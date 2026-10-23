import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../modules/production_runs"
import type ProductionRunService from "../../../modules/production_runs/service"

/**
 * Partner tasks done FOR a production run by a partner who may not be its
 * maker (a photographer's shoot for a weaver's run). Stored in
 * `production_run_partner_task`, never in the `production-runs-tasks` link —
 * see the model for why that link must not see these tasks.
 */

const serviceOf = (scope: any): ProductionRunService =>
  scope.resolve(PRODUCTION_RUNS_MODULE)

export type RunSummary = {
  id: string
  status: string | null
  run_type: string | null
  quantity: number | null
  partner_id: string | null
  design_id: string | null
  design_name: string | null
}

/**
 * Point a task at a run, move it to another run, or (null) detach it.
 * The run must exist; any partner may do a task for any run.
 */
export async function setTaskProductionRun(
  scope: any,
  input: { task_id: string; partner_id: string; production_run_id: string | null }
): Promise<void> {
  const service = serviceOf(scope)
  const existing = await service.listProductionRunPartnerTasks({
    task_id: input.task_id,
  } as any)

  if (input.production_run_id) {
    const run = await service
      .retrieveProductionRun(input.production_run_id)
      .catch(() => null)
    if (!run) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `Production run ${input.production_run_id} not found`
      )
    }
    if (existing.some((r: any) => r.production_run_id === input.production_run_id)) {
      return
    }
  }

  if (existing.length) {
    await service.softDeleteProductionRunPartnerTasks(existing.map((r: any) => r.id))
  }
  if (input.production_run_id) {
    await service.createProductionRunPartnerTasks({
      production_run_id: input.production_run_id,
      task_id: input.task_id,
      partner_id: input.partner_id,
    } as any)
  }
}

async function summariseRuns(scope: any, runIds: string[]): Promise<Map<string, RunSummary>> {
  const out = new Map<string, RunSummary>()
  if (!runIds.length) return out
  const runs = await serviceOf(scope).listProductionRuns({ id: runIds } as any)
  const designIds = [...new Set(runs.map((r: any) => r.design_id).filter(Boolean))]
  const names = new Map<string, string>()
  if (designIds.length) {
    const query = scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "design",
      fields: ["id", "name"],
      filters: { id: designIds },
    })
    for (const d of data as any[]) names.set(d.id, d.name ?? null)
  }
  for (const r of runs as any[]) {
    out.set(r.id, {
      id: r.id,
      status: r.status ?? null,
      run_type: r.run_type ?? null,
      quantity: r.quantity ?? null,
      partner_id: r.partner_id ?? null,
      design_id: r.design_id ?? null,
      design_name: r.design_id ? names.get(r.design_id) ?? null : null,
    })
  }
  return out
}

/** task id → the run it is done for (only tasks that have one). */
export async function runsForTasks(
  scope: any,
  taskIds: string[]
): Promise<Map<string, RunSummary>> {
  const out = new Map<string, RunSummary>()
  if (!taskIds.length) return out
  const rows = await serviceOf(scope).listProductionRunPartnerTasks({
    task_id: taskIds,
  } as any)
  const runs = await summariseRuns(scope, [...new Set(rows.map((r: any) => r.production_run_id))])
  for (const row of rows as any[]) {
    const run = runs.get(row.production_run_id)
    if (run) out.set(row.task_id, run)
  }
  return out
}

/**
 * Adds `production_run` (or null) to each task, for list and detail responses.
 * `forPartner` drops the run's maker: a photographer sees which piece the
 * shoot is for, not which other partner makes it.
 */
export async function withProductionRun<T extends { id: string }>(
  scope: any,
  tasks: T[],
  options: { forPartner?: boolean } = {}
): Promise<Array<T & { production_run: Partial<RunSummary> | null }>> {
  const runs = await runsForTasks(scope, tasks.map((t) => t.id))
  return tasks.map((t) => {
    const run = runs.get(t.id)
    if (!run) return { ...t, production_run: null }
    if (!options.forPartner) return { ...t, production_run: run }
    const { partner_id: _maker, ...visible } = run
    return { ...t, production_run: visible }
  })
}

/** The partner tasks done for one run, each with its partner. */
export async function listRunPartnerTasks(scope: any, runId: string) {
  const rows = await serviceOf(scope).listProductionRunPartnerTasks({
    production_run_id: runId,
  } as any)
  if (!rows.length) return []
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "task",
    fields: [
      "id",
      "title",
      "description",
      "status",
      "priority",
      "start_date",
      "end_date",
      "completed_at",
      "estimated_cost",
      "actual_cost",
      "cost_currency",
      "cost_type",
      "partners.id",
      "partners.name",
      "partners.handle",
    ],
    filters: { id: rows.map((r: any) => r.task_id) },
  })
  return (data as any[]).map((t) => {
    const { partners, ...task } = t
    return { ...task, partner: (partners ?? [])[0] ?? null }
  })
}
