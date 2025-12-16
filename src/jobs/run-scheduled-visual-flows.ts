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

    try {
      const { result, errors } = await executeVisualFlowWorkflow(container).run({
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

      if (errors?.length) {
        await service.updateVisualFlows({
          id: flow.id,
          metadata: {
            ...(flow.metadata || {}),
            schedule: {
              ...((flow.metadata || {}) as any).schedule,
              last_run_minute_key: nowKey,
              last_run_at: now.toISOString(),
              last_status: "failed",
              last_error: "Workflow execution returned errors",
            },
          },
        } as any)

        continue
      }

      await service.updateVisualFlows({
        id: flow.id,
        metadata: {
          ...(flow.metadata || {}),
          schedule: {
            ...((flow.metadata || {}) as any).schedule,
            last_run_minute_key: nowKey,
            last_run_at: now.toISOString(),
            last_execution_id: result?.executionId,
            last_status: "completed",
          },
        },
      } as any)
    } catch (e: any) {
      logger.error(`[run-scheduled-visual-flows] flow=${flow.id} error=${e?.message}`)

      await service.updateVisualFlows({
        id: flow.id,
        metadata: {
          ...(flow.metadata || {}),
          schedule: {
            ...((flow.metadata || {}) as any).schedule,
            last_run_minute_key: nowKey,
            last_run_at: now.toISOString(),
            last_status: "failed",
            last_error: e?.message,
          },
        },
      } as any)
    }
  }
}

export const config = {
  name: "run-scheduled-visual-flows",
  schedule: "* * * * *",
}
