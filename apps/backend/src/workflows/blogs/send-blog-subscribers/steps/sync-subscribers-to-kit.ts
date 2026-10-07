import { StepResponse, createStep } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Subscriber } from "../types"
import { KIT_MODULE } from "../../../../modules/kit"
import type KitService from "../../../../modules/kit/service"
import { EMAIL_SUPPRESSION_MODULE } from "../../../../modules/email_suppression"
import { reasonSuppresses, normalizeEmail } from "../../../../modules/email_suppression/suppress-core"

export const syncSubscribersToKitStepId = "sync-subscribers-to-kit"

// Kit API-key auth is capped at 120 req / rolling 60s. Each subscriber costs 2
// requests (upsert + tag), so we pace at ~1 subscriber/sec to stay well under.
const PER_SUBSCRIBER_DELAY_MS = 1100

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Remove every suppressed address from the Kit tag.
 *
 * Extracted from the step body so the WIRING is testable, not just the client
 * method: `untagSubscriber` had a green service spec and no caller for months
 * (#1782), which is exactly the failure a helper-only test cannot catch.
 *
 * Best-effort: a Kit failure is counted and logged, never thrown — a broadcast
 * must not be blocked by the cleanup of a previous one.
 */
export async function untagSuppressedInKit(
  kit: Pick<KitService, "untagSubscriberByEmail">,
  suppressed: Iterable<string>,
  logger: { info: (m: string) => void; error: (m: string) => void },
  pauseMs = PER_SUBSCRIBER_DELAY_MS
): Promise<{ untagged: number; missing: number; failed: number }> {
  let untagged = 0
  let missing = 0
  let failed = 0
  let seen = 0
  for (const email of suppressed) {
    if (!email) continue
    seen++
    try {
      const out = await kit.untagSubscriberByEmail(email)
      if (out.untagged) untagged++
      else missing++
    } catch (e) {
      failed++
      logger.error(
        `[syncSubscribersToKit] Failed to untag suppressed ${email}: ${(e as Error).message}`
      )
    }
    await sleep(pauseMs)
  }
  if (seen) {
    logger.info(
      `[syncSubscribersToKit] Untagged ${untagged} suppressed address(es) ` +
        `(${missing} unknown to Kit, ${failed} failed)`
    )
  }
  return { untagged, missing, failed }
}

/**
 * PURE: who must come off the tag — every address the ledger suppresses that
 * is still on it, plus this send's own suppressed audience.
 *
 * 🔴 The ledger, not the audience, is the source. `getSubscribersStep` already
 * drops anyone flagged bounced/unsubscribed, so a suppressed address that an
 * earlier send tagged never reaches this step's audience — and an untag set
 * built from the audience alone never contained it. On 2026-10-07 that sent
 * the Luna broadcast to 534 tagged addresses against 509 synced: 15 test
 * addresses suppressed that morning were still on the tag and got it.
 */
export function selectAddressesToUntag(
  ledgerRows: Array<{ email?: string | null; reason?: string | null }>,
  tagEmails: Iterable<string>,
  alsoUntag: Iterable<string> = []
): Set<string> {
  const onTag = new Set<string>()
  for (const e of tagEmails) {
    const n = normalizeEmail(e)
    if (n) onTag.add(n)
  }
  const out = new Set<string>()
  for (const row of ledgerRows || []) {
    if (!row?.reason || !reasonSuppresses(row.reason as any)) continue
    const n = normalizeEmail(row.email)
    if (n && onTag.has(n)) out.add(n)
  }
  for (const e of alsoUntag) {
    const n = normalizeEmail(e)
    if (n) out.add(n)
  }
  return out
}

/**
 * Sync-time gate + push for the Kit broadcast path.
 *
 * `getSubscribersStep` already drops bounced/unsubscribed/dormant addresses;
 * this step additionally hard-excludes anything in the centralized
 * `email_suppression` ledger, then upserts + tags each survivor in Kit so the
 * broadcast (filtered on the tag) reaches exactly the addresses we'd mail.
 *
 * Gating happens HERE (at sync) rather than at send: Kit decides recipients by
 * tag, so a suppressed address is both kept off the tag AND actively removed
 * from it.
 *
 * ⚠️ Both halves are required. The tag is persistent state on Kit's side —
 * skipping the tag call for a suppressed address does nothing for someone an
 * earlier send already tagged, and they keep receiving every broadcast. That
 * was the hole this step shipped with (#1782): `untagSubscriber` existed on the
 * service, was documented as "used to drop a now-suppressed address", and had
 * no caller anywhere in the backend.
 */
export const syncSubscribersToKitStep = createStep(
  syncSubscribersToKitStepId,
  async (input: { subscribers: Subscriber[] }, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const kit = container.resolve(KIT_MODULE) as KitService
    const suppression: any = container.resolve(EMAIL_SUPPRESSION_MODULE)

    const subscribers = input.subscribers || []
    const emails = subscribers.map((s) => normalizeEmail(s.email)).filter(Boolean)

    // Hard-exclude via the suppression ledger (a suppressing reason only).
    const suppressed = new Set<string>()
    if (emails.length) {
      try {
        const rows: any[] = await suppression.listEmailSuppressions(
          { email: emails },
          { take: emails.length }
        )
        for (const row of rows || []) {
          if (reasonSuppresses(row.reason)) {
            suppressed.add(normalizeEmail(row.email))
          }
        }
      } catch (e) {
        logger.warn(
          `[syncSubscribersToKit] Suppression lookup failed, proceeding without it: ${(e as Error).message}`
        )
      }
    }

    const eligible = subscribers.filter(
      (s) => !suppressed.has(normalizeEmail(s.email))
    )
    logger.info(
      `[syncSubscribersToKit] ${eligible.length} eligible / ${subscribers.length} subscribers (${suppressed.size} suppressed)`
    )

    let synced = 0
    let failed = 0
    for (const sub of eligible) {
      const email = normalizeEmail(sub.email)
      if (!email) continue
      try {
        await kit.upsertSubscriber({ email, first_name: sub.first_name })
        await kit.tagSubscriber(email)
        synced++
      } catch (e) {
        failed++
        logger.error(
          `[syncSubscribersToKit] Failed to sync ${email}: ${(e as Error).message}`
        )
      }
      await sleep(PER_SUBSCRIBER_DELAY_MS)
    }

    // Actively REMOVE suppressed addresses from the tag (#1782).
    //
    // Not tagging someone this time does not untag them: the Kit tag is
    // persistent state, so anyone tagged by an earlier send stays on it and
    // keeps receiving broadcasts even after they hard-bounce. The docblock
    // above used to claim "a suppressed address simply never gets tagged",
    // which is only true for an address that was suppressed BEFORE its first
    // sync. Everyone else leaked.
    //
    // Best-effort by design: a Kit outage must not stop a send. Each untag is
    // 2 requests (lookup + delete), so it is paced like the sync loop.
    //
    // Reconcile the WHOLE tag against the WHOLE ledger, not just this audience
    // — see selectAddressesToUntag. A failed read falls back to the audience's
    // own suppressed set, which is what this step did before.
    let toUntag: Set<string> = suppressed
    try {
      const [ledger, tagEmails] = await Promise.all([
        suppression.listEmailSuppressions({}, { select: ["email", "reason"], take: null }),
        kit.listTagSubscriberEmails(),
      ])
      toUntag = selectAddressesToUntag(ledger as any[], tagEmails, suppressed)
    } catch (e) {
      logger.warn(
        `[syncSubscribersToKit] Tag/ledger reconcile failed, untagging this audience's suppressed only: ${(e as Error).message}`
      )
    }
    const { untagged } = await untagSuppressedInKit(kit, toUntag, logger)

    logger.info(
      `[syncSubscribersToKit] Synced ${synced}, failed ${failed} (recipient_count=${synced})`
    )
    return new StepResponse({
      syncedCount: synced,
      failedCount: failed,
      untaggedCount: untagged,
    })
  }
)
