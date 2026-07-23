import { EMAIL_ENGAGEMENT_MODULE } from "../../../../modules/email_engagement"
import {
  classifyEngagement,
  DEFAULT_ENGAGEMENT_THRESHOLDS,
  type EngagementStatus,
  type EngagementThresholds,
} from "../../../../modules/email_engagement/classifier"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/** Split into fixed-size batches so a large ledger never becomes one unbounded UPDATE. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

const WRITE_BATCH = 500

const ALL_STATUSES: EngagementStatus[] = [
  "engaged",
  "cooling",
  "dormant",
  "never_opened",
  "unknown",
]

function numParam(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Recompute the persisted `engagement_status` on every `email_engagement` row
 * from its live counters (#881 engagement scoring). This is the visibility +
 * win-back feed; the send-path gate recomputes live, so this never has to be
 * fresh for correctness — it just keeps the queryable status current.
 *
 * Dry-run reports the status distribution + how many rows would change without
 * writing; apply persists only the rows whose status actually changed
 * (change-detected + batched, so a settled ledger re-run is a near no-op).
 * Thresholds are overridable per run so the operator can tune the policy from
 * the ops UI without a deploy.
 */
export const recomputeEmailEngagementStatusJob: MaintenanceJob = {
  id: "recompute-email-engagement-status",
  label: "Recompute email engagement status",
  description:
    "Classify every email_engagement row (engaged / cooling / dormant / never_opened / unknown) from its delivery/open/click counters and persist engagement_status. Dry-run reports the distribution + change count without writing; apply updates only changed rows. Only `dormant` is excluded from bulk sends (soft exclusion — rows stay visible). Thresholds tunable per run.",
  params: [
    {
      name: "dormant_cold_streak",
      type: "number",
      required: false,
      description: "Deliveries-since-last-open (or deliveries if never opened) to reach `dormant`. Default 5.",
    },
    {
      name: "dormant_min_span_days",
      type: "number",
      required: false,
      description: "Min age (days) of the first delivery before `dormant` can apply. Default 30.",
    },
    {
      name: "cooling_cold_streak",
      type: "number",
      required: false,
      description: "Cold streak that flags an ever-engaged contact as `cooling` (win-back). Default 3.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const service: any = container.resolve(EMAIL_ENGAGEMENT_MODULE)

    const thresholds: Partial<EngagementThresholds> = {
      dormantColdStreak: numParam(params.dormant_cold_streak, DEFAULT_ENGAGEMENT_THRESHOLDS.dormantColdStreak),
      dormantMinSpanDays: numParam(params.dormant_min_span_days, DEFAULT_ENGAGEMENT_THRESHOLDS.dormantMinSpanDays),
      coolingColdStreak: numParam(params.cooling_cold_streak, DEFAULT_ENGAGEMENT_THRESHOLDS.coolingColdStreak),
    }

    const rows: any[] = await service
      .listEmailEngagements(
        {},
        {
          select: [
            "id",
            "email",
            "delivered_count",
            "opens_count",
            "clicks_count",
            "delivered_since_last_open",
            "first_delivered_at",
            "last_open_at",
            "engagement_status",
          ],
          take: null,
        }
      )
      .catch(() => [])

    const now = new Date()
    const nowIso = now.toISOString()
    const dist: Record<EngagementStatus, number> = {
      engaged: 0,
      cooling: 0,
      dormant: 0,
      never_opened: 0,
      unknown: 0,
    }
    const toUpdate: Array<{ id: string; engagement_status: EngagementStatus; status_computed_at: string }> = []

    for (const r of rows) {
      const { status } = classifyEngagement(r, { now, thresholds })
      dist[status]++
      if (r.engagement_status !== status) {
        toUpdate.push({ id: r.id, engagement_status: status, status_computed_at: nowIso })
      }
    }

    if (!dry_run && toUpdate.length) {
      for (const batch of chunk(toUpdate, WRITE_BATCH)) {
        await service.updateEmailEngagements(batch)
      }
    }

    const changes: MaintenanceChange[] = [
      { entity: "email_engagement", id: "changed", field: "count", after: toUpdate.length },
      ...ALL_STATUSES.map(
        (s): MaintenanceChange => ({ entity: "email_engagement", id: `status:${s}`, field: "count", after: dist[s] })
      ),
    ]

    const verb = dry_run ? "Would reclassify" : "Reclassified"
    return {
      job_id: recomputeEmailEngagementStatusJob.id,
      dry_run,
      applied: !dry_run && toUpdate.length > 0,
      summary:
        `${verb} ${rows.length} engagement row(s) — ${toUpdate.length} changed. ` +
        `Distribution: ${ALL_STATUSES.map((s) => `${s}=${dist[s]}`).join(", ")}` +
        ` (dormant ${dist.dormant} dropped from bulk).`,
      changes,
    }
  },
}

export default recomputeEmailEngagementStatusJob
