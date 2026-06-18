import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { VISUAL_FLOWS_MODULE } from "../modules/visual_flows"
import VisualFlowService from "../modules/visual_flows/service"
import { executeVisualFlowWorkflow } from "../workflows/visual-flows"

function parseCronParts(cron: string): string[] | null {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    return null
  }
  return parts
}

function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  const f = field.trim()

  if (f === "*") {
    return true
  }

  const listParts = f.split(",").map((p) => p.trim()).filter(Boolean)
  for (const part of listParts) {
    if (part.includes("/")) {
      const [rangePart, stepPart] = part.split("/")
      const step = Number(stepPart)
      if (!Number.isFinite(step) || step <= 0) {
        continue
      }

      let start = min
      let end = max

      if (rangePart && rangePart !== "*") {
        if (rangePart.includes("-")) {
          const [s, e] = rangePart.split("-")
          start = Number(s)
          end = Number(e)
        } else {
          start = Number(rangePart)
          end = max
        }
      }

      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        continue
      }

      if (value < start || value > end) {
        continue
      }

      if ((value - start) % step === 0) {
        return true
      }

      continue
    }

    if (part.includes("-")) {
      const [s, e] = part.split("-")
      const start = Number(s)
      const end = Number(e)
      if (!Number.isFinite(start) || !Number.isFinite(end)) {
        continue
      }
      if (value >= start && value <= end) {
        return true
      }
      continue
    }

    const n = Number(part)
    if (Number.isFinite(n) && n === value) {
      return true
    }
  }

  return false
}

function cronMatchesNow(cron: string, date: Date): boolean {
  const parts = parseCronParts(cron)
  if (!parts) {
    return false
  }

  const [minField, hourField, domField, monthField, dowField] = parts

  const minute = date.getMinutes()
  const hour = date.getHours()
  const dayOfMonth = date.getDate()
  const month = date.getMonth() + 1
  const dayOfWeek = date.getDay()

  return (
    cronFieldMatches(minField, minute, 0, 59) &&
    cronFieldMatches(hourField, hour, 0, 23) &&
    cronFieldMatches(domField, dayOfMonth, 1, 31) &&
    cronFieldMatches(monthField, month, 1, 12) &&
    cronFieldMatches(dowField, dayOfWeek, 0, 6)
  )
}

function minuteKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `${y}-${m}-${d}T${hh}:${mm}`
}

/**
 * Merge a patch into `metadata.schedule` without clobbering the rest of the
 * flow's metadata. Re-reads the flow fresh on every write because Medusa
 * replaces the whole `metadata` blob on update — spreading a stale snapshot
 * (captured at scan time, minutes/days before a long-running flow finishes)
 * would drop concurrent writes. We only ever touch the `schedule` sub-object.
 */
async function patchScheduleMeta(
  service: VisualFlowService,
  flowId: string,
  patch: Record<string, any>
): Promise<void> {
  const current: any = await service.retrieveVisualFlow(flowId)
  const metadata = (current?.metadata || {}) as any
  await service.updateVisualFlows({
    id: flowId,
    metadata: {
      ...metadata,
      schedule: {
        ...(metadata.schedule || {}),
        ...patch,
      },
    },
  } as any)
}

export default async function runScheduledVisualFlows(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: VisualFlowService = container.resolve(VISUAL_FLOWS_MODULE)

  const now = new Date()
  const nowKey = minuteKey(now)

  const flows = await service.listVisualFlows({
    trigger_type: "schedule",
    status: "active",
  } as any)

  for (const flow of flows as any[]) {
    const cron = flow?.trigger_config?.cron
    if (!cron || typeof cron !== "string") {
      continue
    }

    if (!cronMatchesNow(cron, now)) {
      continue
    }

    const lastRunKey = flow?.metadata?.schedule?.last_run_minute_key
    if (lastRunKey === nowKey) {
      continue
    }

    // Enqueue marker — written BEFORE the flow is fired so the every-minute
    // scanner never double-enqueues a flow, even when the run is long-lived
    // (durable waits) or a slow tick overlaps the next one. Dedup is keyed on
    // this `last_run_minute_key`, so it must land synchronously.
    try {
      await patchScheduleMeta(service, flow.id, {
        last_run_minute_key: nowKey,
        last_run_at: now.toISOString(),
        last_enqueued_at: now.toISOString(),
        last_status: "enqueued",
        last_error: null,
      })
    } catch (e: any) {
      logger.error(
        `[run-scheduled-visual-flows] flow=${flow.id} failed to mark enqueue: ${e?.message}`
      )
      continue
    }

    // Fire-and-forget: the durable workflow runs in the worker. We deliberately
    // do NOT await it — one slow or long-running flow must not block the
    // scanner or the other due flows in this tick (mirrors the webhook async
    // path). Final status is recorded from the resolved/rejected callbacks.
    void executeVisualFlowWorkflow(container)
      .run({
        input: {
          flowId: flow.id,
          triggerData: {
            schedule: {
              cron,
              run_at: now.toISOString(),
              minute_key: nowKey,
            },
          },
          triggeredBy: "schedule",
          metadata: {
            schedule: {
              cron,
              run_at: now.toISOString(),
              minute_key: nowKey,
            },
          },
        },
      })
      .then(({ result, errors }) => {
        if (errors?.length) {
          return patchScheduleMeta(service, flow.id, {
            last_status: "failed",
            last_error: "Workflow execution returned errors",
          })
        }
        return patchScheduleMeta(service, flow.id, {
          last_execution_id: result?.executionId,
          last_status: "completed",
        })
      })
      .catch((e: any) => {
        logger.error(`[run-scheduled-visual-flows] flow=${flow.id} error=${e?.message}`)
        return patchScheduleMeta(service, flow.id, {
          last_status: "failed",
          last_error: e?.message,
        }).catch(() => {
          /* best-effort status write */
        })
      })
  }
}

export const config = {
  name: "run-scheduled-visual-flows",
  schedule: "* * * * *",
}
