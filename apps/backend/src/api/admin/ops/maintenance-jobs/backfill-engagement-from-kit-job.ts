import { EMAIL_ENGAGEMENT_MODULE } from "../../../../modules/email_engagement"
import { normalizeEmail } from "../../../../modules/email_suppression/suppress-core"
import {
  firstDeliveredAtFromSentCount,
  mergeKitStats,
} from "../../../../modules/email_engagement/kit-backfill-core"
import { KIT_MODULE } from "../../../../modules/kit"
import type KitService from "../../../../modules/kit/service"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * Backfill `email_engagement` from Kit's per-subscriber stats (#1785).
 *
 * The engagement gate (#881) classifies almost nobody on the newsletter list —
 * 211 rows against a 524-strong audience, 172 of them `unknown` — because
 * nothing on the Kit path records a delivery or an open. Kit registers only
 * bounce/complain/unsubscribe webhooks, `parseKitEngagement` can emit only
 * `click`, and that rule is not auto-registered because Kit wants a URL per
 * rule. Opens exist solely as broadcast AGGREGATES, which cannot be attributed
 * to a person.
 *
 * `GET /v4/subscribers/{id}/stats` closes it as a pull. This job walks the
 * broadcast tag — the true audience, including people carried over from earlier
 * sends — pulls each subscriber's totals and folds them in as a DELTA against
 * the stored `kit_*` snapshot, so a re-run is a no-op and the Mailjet/Resend
 * history is never overwritten.
 *
 * It writes COUNTERS only. Classification is already free:
 * `recompute-email-engagement-status` reads these counters and persists
 * `engagement_status`, and the send-path gate classifies live regardless.
 */

const PER_PAGE = 100
/** Kit allows 120 req / rolling 60s; each subscriber costs 1 stats call. */
const PER_SUBSCRIBER_DELAY_MS = 550
const WRITE_BATCH = 200
/** Hard stop so a runaway tag can never spin forever against a rate limit. */
const MAX_SUBSCRIBERS = 20_000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function numParam(raw: unknown, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const backfillEngagementFromKitJob: MaintenanceJob = {
  id: "backfill-engagement-from-kit",
  label: "Backfill email engagement from Kit",
  description:
    "Walk the Kit broadcast tag, pull each subscriber's sent/opened/clicked totals, and fold them into the email_engagement ledger so newsletter contacts can be classified at all (#1785). Kit publishes no per-recipient delivery or open webhook, so this pull is the only route. Applies a DELTA against the last Kit snapshot, so re-running is a no-op and transactional history from the Mailjet/Resend webhooks is never overwritten; a lower total from Kit never claws counters back. Writes counters only — run recompute-email-engagement-status afterwards to persist the statuses. Dry-run reports what would change, including how many rows are new, and writes nothing.",
  params: [
    {
      name: "limit",
      type: "number",
      required: false,
      description: "Stop after this many subscribers (default: the whole tag).",
    },
    {
      name: "delay_ms",
      type: "number",
      required: false,
      description: "Pause between Kit stats calls. Default 550 (~2/s, under Kit's 120/60s).",
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const kit = container.resolve(KIT_MODULE) as KitService
    const service: any = container.resolve(EMAIL_ENGAGEMENT_MODULE)
    const now = new Date()

    const limit = numParam(params?.limit, MAX_SUBSCRIBERS)
    const delayMs = numParam(params?.delay_ms, PER_SUBSCRIBER_DELAY_MS)

    // Broadcast send times, newest first — `sent = N` means the last N of these,
    // so the Nth from the end is the subscriber's first delivery. Exact, not a
    // proxy: dating from the subscriber's `created_at` would predate their
    // first send and overstate the dormancy span.
    const broadcasts = await kit.listBroadcasts()
    const broadcastSendsDesc: string[] = broadcasts
      .map((b: any) => b?.send_at || b?.created_at)
      .filter(Boolean)
      .map((s: string) => new Date(s).toISOString())
      .sort()
      .reverse()

    // 1. Walk the tag.
    const subscribers: Array<{ id: string; email: string }> = []
    let cursor: string | null = null
    do {
      const page = await kit.listTagSubscribers({
        perPage: PER_PAGE,
        after: cursor ?? undefined,
      })
      for (const s of page.subscribers) {
        const email = normalizeEmail(s?.email_address ?? "")
        if (email && s?.id) subscribers.push({ id: String(s.id), email })
        if (subscribers.length >= limit) break
      }
      cursor = subscribers.length >= limit ? null : page.nextCursor
    } while (cursor)

    // 2. Existing rows, by email.
    const emails = subscribers.map((s) => s.email)
    const existingRows: any[] = emails.length
      ? await service.listEmailEngagements({ email: emails }, { take: null })
      : []
    const byEmail = new Map<string, any>(
      existingRows.map((r: any) => [normalizeEmail(r.email), r])
    )

    // 3. Pull stats and fold.
    const toUpdate: any[] = []
    const toCreate: any[] = []
    let statsFailed = 0
    let unchanged = 0
    for (const sub of subscribers) {
      let stats: any = null
      try {
        stats = await kit.getSubscriberStats(sub.id)
      } catch {
        statsFailed++
        await sleep(delayMs)
        continue
      }
      if (!stats) {
        statsFailed++
        await sleep(delayMs)
        continue
      }

      const existing = byEmail.get(sub.email) ?? null
      const merged = mergeKitStats(existing, stats, {
        firstDeliveredAt: firstDeliveredAtFromSentCount(
          Number(stats.sent ?? 0),
          broadcastSendsDesc
        ),
        now,
      })

      if (existing) {
        // `changed` covers the engagement counters; the snapshot moving on its
        // own still has to be persisted or the next run recomputes the same
        // delta forever.
        const snapshotMoved =
          merged.kit_sent !== Number(existing.kit_sent ?? 0) ||
          merged.kit_opened !== Number(existing.kit_opened ?? 0) ||
          merged.kit_clicked !== Number(existing.kit_clicked ?? 0)
        if (!merged.changed && !snapshotMoved) {
          unchanged++
          await sleep(delayMs)
          continue
        }
        const { changed, ...fields } = merged
        toUpdate.push({ id: existing.id, ...fields })
      } else {
        const { changed, ...fields } = merged
        toCreate.push({ email: sub.email, ...fields })
      }
      await sleep(delayMs)
    }

    if (!dry_run) {
      for (let i = 0; i < toCreate.length; i += WRITE_BATCH) {
        await service.createEmailEngagements(toCreate.slice(i, i + WRITE_BATCH))
      }
      for (let i = 0; i < toUpdate.length; i += WRITE_BATCH) {
        await service.updateEmailEngagements(toUpdate.slice(i, i + WRITE_BATCH))
      }
    }

    const changes: MaintenanceChange[] = [
      { entity: "email_engagement", id: "created", field: "count", after: toCreate.length },
      { entity: "email_engagement", id: "updated", field: "count", after: toUpdate.length },
      { entity: "email_engagement", id: "unchanged", field: "count", after: unchanged },
      { entity: "kit", id: "tag_subscribers", field: "count", after: subscribers.length },
      { entity: "kit", id: "broadcasts", field: "count", after: broadcastSendsDesc.length },
      { entity: "kit", id: "stats_failed", field: "count", after: statsFailed },
    ]

    const verb = dry_run ? "Would fold" : "Folded"
    return {
      job_id: backfillEngagementFromKitJob.id,
      dry_run,
      applied: !dry_run && (toCreate.length > 0 || toUpdate.length > 0),
      summary:
        `${verb} Kit stats for ${subscribers.length} tagged subscriber(s) across ` +
        `${broadcastSendsDesc.length} broadcast(s): ${toCreate.length} new row(s), ` +
        `${toUpdate.length} updated, ${unchanged} already current` +
        (statsFailed ? `, ${statsFailed} stats call(s) failed` : "") +
        `. Counters only — run recompute-email-engagement-status to persist statuses.`,
      changes,
    }
  },
}

export default backfillEngagementFromKitJob
