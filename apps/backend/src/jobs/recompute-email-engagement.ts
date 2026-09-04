import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { EMAIL_ENGAGEMENT_MODULE } from "../modules/email_engagement"
import {
  classifyEngagement,
  type EngagementStatus,
} from "../modules/email_engagement/classifier"

/**
 * recompute-email-engagement — keep `engagement_status` current on its own.
 *
 * The classification existed only as a MANUAL maintenance job
 * (`recompute-email-engagement-status`), so the persisted status was whatever
 * the last human run left behind. Raw ingestion is automatic — the Mailjet and
 * Resend webhooks fold every delivery/open/click as it arrives — but nothing
 * ever re-derived the status from those counters.
 *
 * That is not a correctness bug: the send-path gate in `get-subscribers`
 * classifies LIVE from the counters, so a stale status has never caused a wrong
 * exclusion. What went stale is everything that READS the persisted value —
 * the Marketing → Engagement view and win-back selection — which is exactly
 * where an operator looks to decide whether the list is healthy.
 *
 * Deliberately thin: it reuses `classifyEngagement` with the default
 * thresholds and writes only the rows whose status actually moved. The
 * maintenance job stays the place to run an ad-hoc pass with tuned thresholds.
 */
const WRITE_BATCH = 500

const ALL_STATUSES: EngagementStatus[] = [
  "engaged",
  "cooling",
  "dormant",
  "never_opened",
  "unknown",
]

export default async function recomputeEmailEngagement(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: any = container.resolve(EMAIL_ENGAGEMENT_MODULE)

  const rows: any[] = await service.listEmailEngagements(
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

  const now = new Date()
  const nowIso = now.toISOString()
  const dist: Record<EngagementStatus, number> = {
    engaged: 0,
    cooling: 0,
    dormant: 0,
    never_opened: 0,
    unknown: 0,
  }
  const toUpdate: Array<{
    id: string
    engagement_status: EngagementStatus
    status_computed_at: string
  }> = []

  for (const r of rows) {
    const { status } = classifyEngagement(r, { now })
    dist[status]++
    if (r.engagement_status !== status) {
      toUpdate.push({ id: r.id, engagement_status: status, status_computed_at: nowIso })
    }
  }

  for (let i = 0; i < toUpdate.length; i += WRITE_BATCH) {
    await service.updateEmailEngagements(toUpdate.slice(i, i + WRITE_BATCH))
  }

  logger.info(
    `[Engagement Recompute] ${rows.length} row(s), ${toUpdate.length} changed — ` +
      ALL_STATUSES.map((s) => `${s}=${dist[s]}`).join(", ")
  )
}

export const config = {
  name: "recompute-email-engagement",
  // 02:10 UTC daily — after the analytics rollups, before anyone reads the
  // Marketing tab in IST business hours.
  schedule: "10 2 * * *",
}
