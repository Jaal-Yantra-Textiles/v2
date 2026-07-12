import { EMAIL_ENGAGEMENT_MODULE } from "../../../../modules/email_engagement"
import { MARKETING_MODULE } from "../../../../modules/marketing"
import {
  DEFAULT_ENGAGEMENT_THRESHOLDS,
  type EngagementThresholds,
} from "../../../../modules/email_engagement/classifier"
import {
  selectNewsletterWinbackTargets,
  DEFAULT_WINBACK_CAP,
} from "../../../../modules/email_engagement/winback-select"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const CAMPAIGN = "newsletter-winback"

/** Hard cap on how many engagement rows one run scans. */
const MAX_SCAN = 5000

function numParam(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

/**
 * #881 Slice 3 — queue newsletter win-back targets from the engagement ledger.
 *
 * Selects `cooling` contacts (engaged before, now on a cold streak but not yet
 * dormant — the pre-dormant nudge window) and creates `marketing_outreach` rows
 * (campaign="newsletter-winback", channel=email, status=queued). Mirrors the
 * churn `generate-winback-targets` job: read-only over engagement, presence-based
 * idempotency (an email already in this campaign is never re-created), dry-run
 * previews without writing. It does NOT send — the existing outreach flow does,
 * and the opens/clicks flow back through the Slice-1 bridge.
 */
export const generateNewsletterWinbackTargetsJob: MaintenanceJob = {
  id: "generate-newsletter-winback-targets",
  label: "Generate newsletter winback targets",
  description:
    "Queue newsletter win-back targets from the email_engagement ledger: select `cooling` contacts (pre-dormant) and create marketing_outreach rows (campaign=newsletter-winback, channel=email, status=queued). Read-only over engagement, idempotent (email already in the campaign is skipped), dry-run previews without writing. Does not send — the outreach flow handles that; opens/clicks reconcile back via the engagement bridge.",
  params: [
    {
      name: "max_targets",
      type: "number",
      required: false,
      description: "Max win-back rows to create per run (coldest first). Default 100.",
    },
    {
      name: "cooling_cold_streak",
      type: "number",
      required: false,
      description: "Cold streak to qualify as `cooling`. Default 3 (must match the recompute policy).",
    },
    {
      name: "dormant_cold_streak",
      type: "number",
      required: false,
      description: "Upper bound — at/above this a contact is `dormant`, not `cooling`. Default 5.",
    },
    {
      name: "dormant_min_span_days",
      type: "number",
      required: false,
      description: "Min first-delivery age (days) before `dormant` applies. Default 30.",
    },
    {
      name: "cooling_idle_days",
      type: "number",
      required: false,
      description:
        "Time-based fallback: an opener whose last open is at least this many days old counts as `cooling` even without a delivery cold streak (covers providers that report opens but not deliveries). Default 30.",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const engagement: any = container.resolve(EMAIL_ENGAGEMENT_MODULE)
    const marketing: any = container.resolve(MARKETING_MODULE)

    const cap = numParam(params.max_targets, DEFAULT_WINBACK_CAP)
    const thresholds: Partial<EngagementThresholds> = {
      coolingColdStreak: numParam(params.cooling_cold_streak, DEFAULT_ENGAGEMENT_THRESHOLDS.coolingColdStreak),
      dormantColdStreak: numParam(params.dormant_cold_streak, DEFAULT_ENGAGEMENT_THRESHOLDS.dormantColdStreak),
      dormantMinSpanDays: numParam(params.dormant_min_span_days, DEFAULT_ENGAGEMENT_THRESHOLDS.dormantMinSpanDays),
      coolingIdleDays: numParam(params.cooling_idle_days, DEFAULT_ENGAGEMENT_THRESHOLDS.coolingIdleDays),
    }

    // Engagement rows (read-only), classified live so a stale stored status
    // never mis-targets.
    const rows: any[] = await engagement
      .listEmailEngagements(
        {},
        {
          select: [
            "email",
            "delivered_count",
            "opens_count",
            "clicks_count",
            "delivered_since_last_open",
            "first_delivered_at",
            "last_open_at",
            "last_delivered_at",
          ],
          take: MAX_SCAN,
        }
      )
      .catch(() => [])

    // Idempotency — emails already in this campaign.
    const existing: any[] = await marketing
      .listMarketingOutreaches({ campaign: CAMPAIGN })
      .catch(() => [])
    const alreadyTargeted = new Set<string>(
      (existing ?? [])
        .map((o) => (o.recipient_email || "").trim().toLowerCase())
        .filter(Boolean)
    )

    const selection = selectNewsletterWinbackTargets(rows, alreadyTargeted, {
      thresholds,
      cap,
    })

    let createdCount = 0
    if (!dry_run && selection.targets.length) {
      const created = await marketing.createMarketingOutreaches(
        selection.targets.map((t) => ({
          recipient_email: t.email,
          campaign: CAMPAIGN,
          channel: "email",
          status: "queued",
          notes: `newsletter winback — cold_streak=${t.cold_streak}${
            t.last_open_at ? `, last_open=${t.last_open_at}` : ", never opened"
          }`,
        }))
      )
      createdCount = Array.isArray(created) ? created.length : created ? 1 : 0
    }

    const { targets, stats } = selection
    const changes: MaintenanceChange[] = targets.map((t) => ({
      entity: "marketing_outreach",
      id: t.email,
      field: "created",
      after: {
        campaign: CAMPAIGN,
        recipient_email: t.email,
        cold_streak: t.cold_streak,
        status: dry_run ? "(would create)" : "queued",
      },
    }))

    const cappedNote = stats.capped > 0 ? ` (${stats.capped} over the cap not selected)` : ""
    const skipNote =
      stats.skipped_already || stats.skipped_no_email
        ? ` Skipped ${stats.skipped_already} already-targeted, ${stats.skipped_no_email} no-email.`
        : ""
    const verb = dry_run ? "Would create" : "Created"
    return {
      job_id: generateNewsletterWinbackTargetsJob.id,
      dry_run,
      applied: !dry_run && createdCount > 0,
      summary:
        `${verb} ${dry_run ? stats.targeted : createdCount} newsletter-winback target(s) ` +
        `from ${stats.cooling} cooling contact(s) (scanned ${stats.scanned})${cappedNote}.${skipNote}`,
      changes,
    }
  },
}

export default generateNewsletterWinbackTargetsJob
